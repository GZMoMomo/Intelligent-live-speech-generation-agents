from flask import Flask, jsonify, request, Response
from datetime import datetime, timedelta
import random
import pandas as pd
import numpy as np
import uuid
import os
import pymysql.cursors
from threading import Lock
from dbutils.pooled_db import PooledDB
import time
from threading import Lock, Thread
import json
from collections import deque
from flask_cors import CORS
from concurrent.futures import ThreadPoolExecutor
import requests

app = Flask(__name__)
CORS(app)
executor = ThreadPoolExecutor(max_workers=5)

# 数据库配置
DB_CONFIG = {
    'host': '120.46.168.100',
    'port': 8306,
    'user': 'nlchatdemo',
    'password': 'nlchatdemo',
    'db': 'nlchatdemo',
    'charset': 'utf8mb4',
    'cursorclass': pymysql.cursors.DictCursor
}

# 商品状态跟踪相关变量
product_state = {
    'current_sku': None,
    'expiry_time': datetime.now(),
    'lock': Lock(),
    'duration_minutes': 3  # 默认持续3分钟
}

# 全局控制变量
batch_control = {
    'running': False,
    'interval': 0.5,  # 默认间隔时间（秒）
    'lock': Lock(),
    'thread': None
}

# 初始化连接池
POOL = PooledDB(
    creator=pymysql,
    maxconnections=10,
    **DB_CONFIG
)

# 添加SSE事件处理器
class MessageAnnouncer:
    def __init__(self):
        self.listeners = []
        self.lock = Lock()
        self.keep_alive_interval = 30  # 保活间隔（秒）

    def listen(self):
        q = deque(maxlen=100)
        with self.lock:
            self.listeners.append(q)
        return q

    def announce(self, msg):
        with self.lock:
            for i in reversed(range(len(self.listeners))):
                try:
                    self.listeners[i].append(msg)
                except Exception as e:
                    # 移除无效监听器
                    del self.listeners[i]

announcer = MessageAnnouncer()

def _send_keep_alive():
    while True:
        time.sleep(announcer.keep_alive_interval)
        announcer.announce(":keep-alive\n\n")

Thread(target=_send_keep_alive, daemon=True).start()

# 添加SSE端点
@app.route('/api/stream')
def stream():
    def generate():
        messages = announcer.listen()
        while True:
            if not messages:
                # 发送心跳保持连接
                yield ":keep-alive\n\n"
                time.sleep(0.5)  # 降低CPU占用
                continue
                
            while messages:
                msg = messages.popleft()
                yield msg
    return Response(generate(), mimetype='text/event-stream')

# 公共数据预处理模块
class DataProcessor:
    def __init__(self):
        self._load_data()
        self._preprocess_data()
        
    def _load_data(self):
        """数据加载"""
        excel_path = os.path.join(os.path.dirname(__file__), "Bailian_Data Sample_LV_20241212.xlsx")
        self.orders = pd.read_excel(excel_path, sheet_name=0)
        self.customers = pd.read_excel(excel_path, sheet_name=1)
        self.products = pd.read_excel(excel_path, sheet_name=2)
        self.descriptions = pd.read_excel(excel_path, sheet_name=3)

    def _preprocess_data(self):
        """数据预处理"""
        # 替换所有"\N"为None（而不是np.nan）
        for df in [self.orders, self.customers, self.products, self.descriptions]:
            df.replace(["\\N", "null", "NaN"], [None]*3, inplace=True)
        
        # 处理商品价格数据
        self.products['list_price'] = pd.to_numeric(self.products['list_price'], errors='coerce').fillna(0.0)
        
        # 客户数据处理
        self.valid_cust_codes = self.customers['cust_code'].dropna().unique().tolist()
        self.customer_map = self.customers.set_index('cust_code').to_dict(orient='index')
        
        # 商品数据处理
        self.product_map = self.products.set_index('item_sku').to_dict(orient='index')
        self.description_map = self.descriptions.set_index('item_sku').to_dict(orient='index')
        
        # 订单合并处理
        self.merged_orders = pd.merge(self.orders, 
                                    self.products[['item_sku', 'list_price', 'item_cate_l1']],
                                    left_on='item_code', right_on='item_sku')
        
        # 热销商品划分
        self.valid_item_skus = self.products['item_sku'].dropna().unique().tolist()
        self.hot_sku_count = max(1, int(len(self.valid_item_skus)*0.2))
        self.hot_skus = self.orders['item_code'].value_counts().head(self.hot_sku_count).index.tolist()
        self.normal_skus = [sku for sku in self.valid_item_skus if sku not in self.hot_skus]

        # 用户画像预计算
        self.user_stats = {}
        for cust_code, group in self.merged_orders.groupby('cust_code'):
            order_count = len(group)
            city_mode = group['recvr_city_name'].mode()
            valid_times = pd.to_datetime(group['order_time'], errors='coerce').dropna()
            time_diff = valid_times.sort_values().diff().dt.days.dropna() if len(valid_times) > 1 else pd.Series()
            
            # 安全地计算价格相关指标
            pay_prices = pd.to_numeric(group['pay_price'], errors='coerce')
            list_prices = pd.to_numeric(group['list_price'], errors='coerce')
            valid_prices = ~(pay_prices.isna() | list_prices.isna())
            discount_count = sum((pay_prices < list_prices) & valid_prices)
            
            self.user_stats[cust_code] = {
                'common_city': city_mode[0] if len(city_mode) > 0 else None,
                'median_freq': time_diff.median() if not time_diff.empty else None,
                'avg_spend': pay_prices[valid_prices].mean() if not pay_prices.empty else 0.0,
                'discount_ratio': discount_count / order_count if order_count > 0 else 0,
                'top_categories': group['item_cate_l1'].value_counts().head(3).index.tolist()
            }

data_processor = DataProcessor()

# 实时互动跟踪模块
class InteractionTracker:
    def __init__(self):
        self.tracker = {}
        self.comments = [
            "这个价格还能再低吗？", "有没有满减活动？", "和上次直播比贵了呀",
            "165cm穿什么码？", "北方现在穿会冷吗？", "机洗会掉色吗？",
            "库存只剩3件了！", "求补XXL码！", "什么时候补货？",
            "已拍2件！", "帮朋友带一件", "下单了改地址可以吗？",
            "主播试下M码效果", "左边款有没有其他颜色？", "能不能再演示下功能？",
            "主播声音好好听！", "关注了每周都来", "明天还播吗？"
        ]
        self.lock = Lock()

    def generate_user_id(self):
        with self.lock:
            if data_processor.valid_cust_codes and random.choices([True, False], weights=[3,7])[0]:
                return random.choice(data_processor.valid_cust_codes)
            return f"游客_{uuid.uuid4().hex[:8]}"

    def track_interaction(self, user_id, behavior, event_time):
        with self.lock:
            try:
                event_time = datetime.fromisoformat(event_time) if isinstance(event_time, str) else event_time
            except:
                event_time = datetime.now()

            if user_id not in self.tracker:
                self.tracker[user_id] = {
                    'start_time': None,
                    'in_room': False,
                    'likes': 0,
                    'shares': 0,
                    'last_active': None
                }

            user_data = self.tracker[user_id]
            
            if behavior == 'enter':
                user_data['start_time'] = event_time
                user_data['in_room'] = True
                user_data['last_active'] = event_time
            elif behavior == 'exit':
                if user_data['in_room']:
                    user_data['in_room'] = False
                    user_data['last_active'] = event_time
            elif behavior == 'like':
                if user_data['in_room']:
                    user_data['likes'] += 1
                    user_data['last_active'] = event_time
            elif behavior == 'share':
                if user_data['in_room']:
                    user_data['shares'] += 1
                    user_data['last_active'] = event_time
            elif behavior == 'comment':
                if user_data['in_room']:
                    user_data['last_active'] = event_time

    def get_active_users(self):
        with self.lock:
            return [uid for uid, data in self.tracker.items() if data['in_room']]

interaction_tracker = InteractionTracker()

def _execute_sql(sql, params):
    try:
        conn = POOL.connection()
        with conn.cursor() as cursor:
            cursor.execute(sql, params)
        conn.commit()
    except Exception as e:
        print(f"Database error: {str(e)}")
        conn.rollback()
    finally:
        conn.close()

@app.route('/api/live-interaction', methods=['GET'])
def generate_interaction():
    # 生成行为逻辑
    active_users = interaction_tracker.get_active_users()
    if active_users and random.random() < 0.6:
        user_id = random.choice(active_users)
        behavior = random.choices(
            ['exit', 'like', 'comment', 'share'],
            weights=[10, 50, 30, 10]
        )[0]
    else:
        behavior = 'enter'
        user_id = interaction_tracker.generate_user_id()

    event_time = datetime.now()
    product_info = _generate_product()
    enriched_product = _enrich_product(product_info['item_sku'])
    
    # 确保价格是有效的数值
    item_price = enriched_product.get('price', 0.0)
    if not isinstance(item_price, (int, float)) or pd.isna(item_price):
        item_price = 0.0

    # 计算停留时间
    stay_duration = 0
    if behavior != 'enter':
        user_data = interaction_tracker.tracker.get(user_id, {})
        if user_data.get('in_room'):
            stay_duration = (event_time - user_data['start_time']).total_seconds()
    
    # 构建数据记录
    interaction_id = uuid.uuid4().hex
    sql = """
    INSERT INTO Bailian_Data_LiveInteractions (
        interaction_id, user_id, behavior_type, event_time,
        comment_content, stay_duration, item_sku,
        item_name, item_category, item_price
    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
    """
    params = (
        interaction_id,
        user_id,
        behavior,
        event_time,
        random.choice(interaction_tracker.comments) if behavior == 'comment' else None,
        int(stay_duration),
        enriched_product['item_sku'],
        enriched_product['name'],
        enriched_product['category'],
        item_price  
    )
    _execute_sql(sql, params)

    # 更新跟踪器
    interaction_tracker.track_interaction(user_id, behavior, event_time)
    
    return jsonify({
        "timestamp": event_time.isoformat(),
        "user_id": user_id,
        "interaction": behavior,
        "comment": params[4],
        "stay_duration": int(stay_duration),
        "product_info": enriched_product
    })

def _generate_product():
    with product_state['lock']:
        now = datetime.now()
        # 如果当前商品未过期，继续使用
        if product_state['current_sku'] and now < product_state['expiry_time']:
            return {"item_sku": product_state['current_sku']}
        
        # 按原逻辑选择新商品
        sku_group = random.choices(
            [data_processor.hot_skus, data_processor.normal_skus],
            weights=[80, 20]
        )[0]
        sku = random.choice(sku_group)

        # 更新状态
        product_state['current_sku'] = sku
        product_state['expiry_time'] = now + timedelta(minutes=product_state['duration_minutes'])
        return {"item_sku": sku}

def _enrich_product(sku):
    product = data_processor.product_map.get(sku, {})
    desc = data_processor.description_map.get(sku, {})
    
    # 安全地获取和转换价格
    list_price = product.get('list_price')
    try:
        price = float(list_price) if list_price is not None else 0.0
        # 添加过滤非数字逻辑
        price = price if not np.isnan(price) else 0.0
    except (ValueError, TypeError):
        price = 0.0
        
    return {
        "item_sku": sku,
        "name": product.get('item_name_cn'),
        "category": product.get('item_cate_l1'),
        "price": price,
        "description": desc.get('item_dsc'),
        "url": desc.get('item_url')
    }

@app.route('/api/user-profile/<user_id>', methods=['GET'])
def get_user_profile(user_id):
    is_guest = user_id.startswith('游客_')
    # 游客只保留互动数据
    profile = {
    'basic': {'gender': None, 'age': None, 'member_level': None, 'registration': None},
    'behavior': {
    'preferred_city': None,
    'avg_spending': 0.0,
    'purchase_cycle': None,
    'discount_sensitivity': 0.0,
    'preferred_categories': []
    },
    'live_interaction': {
    'total_likes': 0,
    'total_shares': 0,
    'last_active': datetime.now().isoformat()
    }
    }

    # 注册用户处理CRM数据
    if not is_guest:
        cust_info = data_processor.customer_map.get(user_id, {})
        stats = data_processor.user_stats.get(user_id, {})

        # 基础信息
        profile['basic'] = {
            'gender': cust_info.get('gender'),
            'age': (datetime.now().year - pd.to_datetime(cust_info.get('birthday')).year)
            if pd.notna(cust_info.get('birthday')) else None,
            'member_level': cust_info.get('mem_local_type'),
            'registration': cust_info.get('rgst_chn_l1')
        }

        # 行为分析
        profile['behavior'] = {
        'preferred_city': stats.get('common_city'),
        'avg_spending': round(float(stats.get('avg_spend', 0)), 2),
        'purchase_cycle': int(stats['median_freq']) if stats.get('median_freq') else None,
        'discount_sensitivity': round(float(stats.get('discount_ratio', 0)) * 100, 2),
        'preferred_categories': stats.get('top_categories', [])
        }

    # 实时互动数据（所有用户）
    interaction_data = interaction_tracker.tracker.get(user_id, {})
    profile['live_interaction'] = {
    'total_likes': interaction_data.get('likes', 0),
    'total_shares': interaction_data.get('shares', 0),
    'last_active': interaction_data.get('last_active', datetime.now()).isoformat()
    }    

    if not is_guest:
        # 注册用户 SQL
        sql = """
        INSERT INTO Bailian_Data_UserProfiles (
            user_id, total_likes, total_shares, last_active_time,
            gender, age, member_level, registration_channel,
            preferred_city, avg_spending, purchase_cycle, discount_sensitivity
        ) VALUES (
            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
        ) ON DUPLICATE KEY UPDATE
            total_likes = VALUES(total_likes),
            total_shares = VALUES(total_shares),
            last_active_time = VALUES(last_active_time),
            gender = COALESCE(VALUES(gender), gender),
            age = COALESCE(VALUES(age), age),
            member_level = COALESCE(VALUES(member_level), member_level),
            registration_channel = COALESCE(VALUES(registration_channel), registration_channel),
            preferred_city = COALESCE(VALUES(preferred_city), preferred_city),
            avg_spending = COALESCE(VALUES(avg_spending), avg_spending),
            purchase_cycle = COALESCE(VALUES(purchase_cycle), purchase_cycle),
            discount_sensitivity = COALESCE(VALUES(discount_sensitivity), discount_sensitivity)
        """
        params = (
            user_id,
            profile['live_interaction']['total_likes'],
            profile['live_interaction']['total_shares'],
            datetime.fromisoformat(profile['live_interaction']['last_active']),
            profile['basic']['gender'],
            profile['basic']['age'],
            profile['basic']['member_level'],
            profile['basic']['registration'],
            profile['behavior']['preferred_city'],
            profile['behavior']['avg_spending'],
            profile['behavior']['purchase_cycle'],
            profile['behavior']['discount_sensitivity']
        )
    else:
        # 游客 SQL
        sql = """
        INSERT INTO Bailian_Data_UserProfiles (
            user_id, total_likes, total_shares, last_active_time
        ) VALUES (
            %s, %s, %s, %s
        ) ON DUPLICATE KEY UPDATE
            total_likes = VALUES(total_likes),
            total_shares = VALUES(total_shares),
            last_active_time = VALUES(last_active_time)
        """
        params = (
            user_id,
            profile['live_interaction']['total_likes'],
            profile['live_interaction']['total_shares'],
            datetime.fromisoformat(profile['live_interaction']['last_active'])
        )

    _execute_sql(sql, params)
    
    return jsonify(profile)

def call_dashscope_api(action_info, user_tag,user_id):
    """调用 DashScope API 并存储结果的异步任务"""
    try:
        # 构造标准JSON对象
        payload = {
            "input": {
                "prompt": " ",
                "action_info": action_info,
                "user_tag": user_tag
            },
            "parameters": {}
        }
        print(payload)
        response = requests.post(
            'https://dashscope.aliyuncs.com/api/v1/apps/393153a22dfe46b79c3826fec8d4c534/completion',
            json=payload,  # 使用字典自动序列化
            headers={'Content-Type': 'application/json','Authorization':'Bearer sk-5825867b9f004646a7dd9aefd5623aaf'}
        )
        
        if response.status_code == 200:
            result = response.json()
            # 提取并处理数据
            try:
                text_data = result.get('output', {}).get('text', '{}')
                parsed_data = json.loads(text_data).get('result', {})
                
                # 提取目标字段
                extracted = {
                    'categoryPreference': parsed_data.get('categoryPreference'),
                    'commentSentiment': parsed_data.get('commentSentiment'),
                    'lifestyleInference': parsed_data.get('lifestyleInference'),
                    'demandIdentification': parsed_data.get('demandIdentification'),
                    'personalityAnalysis': parsed_data.get('personalityAnalysis'),
                    'purchaseDecisionPattern': parsed_data.get('purchaseDecisionPattern'),
                    'priceToleranceLevel': parsed_data.get('priceToleranceLevel')
                }
                
                # 构建SQL语句
                sql = """
                        INSERT INTO nlchatdemo.bailian_data_userprofiles 
                        (user_id, categoryPreference, commentSentiment, lifestyleInference, 
                        demandIdentification, personalityAnalysis, purchaseDecisionPattern, priceToleranceLevel)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                        ON DUPLICATE KEY UPDATE
                        categoryPreference = VALUES(categoryPreference),
                        commentSentiment = VALUES(commentSentiment),
                        lifestyleInference = VALUES(lifestyleInference),
                        demandIdentification = VALUES(demandIdentification),
                        personalityAnalysis = VALUES(personalityAnalysis),
                        purchaseDecisionPattern = VALUES(purchaseDecisionPattern),
                        priceToleranceLevel = VALUES(priceToleranceLevel);
                """
                
                # 参数元组
                params = (
                    user_id,
                    extracted['categoryPreference'],
                    extracted['commentSentiment'],
                    extracted['lifestyleInference'],
                    extracted['demandIdentification'],
                    extracted['personalityAnalysis'],
                    extracted['purchaseDecisionPattern'],
                    extracted['priceToleranceLevel']
                )
                
                # 执行SQL
                _execute_sql(sql, params)
            except json.JSONDecodeError as e:
                print(f"JSON解析错误: {str(e)}")
            except KeyError as e:
                print(f"字段缺失错误: {str(e)}")
            
            return True
    except Exception as e:
        print(f"Error in async task: {str(e)}")
    return False

# 后台任务线程函数
def _batch_task(iterations):
    with app.test_client() as client:
        for _ in range(iterations):
            # 检查是否已停止
            with batch_control['lock']:
                if not batch_control['running']:
                    break
                current_interval = batch_control['interval']

            # 生成交互数据
            live_resp = client.get('/api/live-interaction')
            live_data = live_resp.get_json()
            user_id = live_data.get('user_id', '')
            
            # 再次检查停止标志
            with batch_control['lock']:
                if not batch_control['running']:
                    break

            # 获取用户画像（如果非游客）
            profile_data = None
            if (not user_id.startswith('游客_') and live_data.get('interaction') != 'enter' and live_data.get('interaction') != 'exit') or (user_id.startswith('游客_') and live_data.get('interaction') == 'comment'):
                profile_resp = client.get(f'/api/user-profile/{user_id}')
                if profile_resp.status_code == 200:
                    profile_data = profile_resp.get_json()
                    # 提交异步任务
                    executor.submit(
                        call_dashscope_api,
                        json.dumps(live_data, ensure_ascii=False).replace('"', r'\"'),  
                        json.dumps(profile_data, ensure_ascii=False).replace('"', r'\"'),
                        user_id
                    )

            # 推送数据到SSE前检查
            with batch_control['lock']:
                if not batch_control['running']:
                    break

            # 推送数据
            if live_data and (profile_data or user_id.startswith('游客_')):
                event_data = {
                    'live_interaction': live_data,
                    'user_profile': profile_data
                }
                announcer.announce(f"data: {json.dumps(event_data)}\n\n")

            # 可中断的间隔等待
            start = time.time()
            while (time.time() - start) < current_interval:
                time.sleep(0.1)  # 每次等待0.1秒
                with batch_control['lock']:
                    if not batch_control['running']:
                        break

            time.sleep(current_interval)

# 新增控制端点
@app.route('/api/batch-control', methods=['POST'])
def batch_control_endpoint():
    action = request.json.get('action')
    
    with batch_control['lock']:
        if action == 'start':
            # 防止重复启动
            if batch_control['running']:
                return jsonify({'status': 'already_running'})
                
            # 获取参数
            batch_control['interval'] = request.json.get('interval', 1)
            iterations = request.json.get('count', 9999) 
            
            # 启动线程
            batch_control['running'] = True
            batch_control['thread'] = Thread(
                target=_batch_task,
                args=(iterations,)
            )
            batch_control['thread'].start()
            return jsonify({'status': 'started', 'interval': batch_control['interval']})
            
        elif action == 'stop':
            if not batch_control['running']:
                return jsonify({'status': 'not_running'})
                
            batch_control['running'] = False
            # 设置超时防止永久阻塞
            batch_control['thread'].join(timeout=5.0)
            if batch_control['thread'].is_alive():
                app.logger.error("后台线程未在超时时间内终止")
            return jsonify({'status': 'stopped'})
            
        return jsonify({'status': 'invalid_action'}), 400

if __name__ == '__main__':

    app.run(host='0.0.0.0', port=5000, debug=False, threaded=True)