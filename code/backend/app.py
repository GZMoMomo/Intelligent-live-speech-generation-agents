from flask import Flask, jsonify, request, Response
from datetime import datetime, timedelta
import random
import pandas as pd
import numpy as np
import uuid
import os
import pymysql.cursors
from dbutils.pooled_db import PooledDB
import time
from threading import Lock, Thread
import json
from collections import deque
from flask_cors import CORS
from concurrent.futures import ThreadPoolExecutor
import requests
from collections import Counter, defaultdict

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

# 直播间统计类
class LiveRoomStats:
    def __init__(self):
        self.lock = Lock()
        self.reset_stats()
        
        # 启动定时任务，计算变化率
        self.rate_calculation_thread = Thread(target=self._calculate_rates, daemon=True)
        self.rate_calculation_thread.start()
    
    def reset_stats(self):
        """重置所有统计数据"""
        with self.lock:
            # 基础用户统计
            self.total_users = set()  # 所有进入过直播间的用户
            self.current_users = set()  # 当前在线用户
            self.guest_users = set()  # 游客用户
            self.registered_users = set()  # 注册用户
            
            # 互动统计
            self.total_likes = 0
            self.total_shares = 0
            self.comments = []  # 所有评论列表
            self.comment_counter = Counter()  # 评论计数器
            
            # 流量统计
            self.traffic_history = []  # 流量历史记录
            self.traffic_timestamps = []  # 对应的时间戳
            self.traffic_rate = 0.0  # 流量变化率
            
            # 高级分析
            self.traffic_sources = Counter()  # 流量来源
            self.user_tags = defaultdict(int)  # 用户标签统计
            self.stay_duration = defaultdict(float)  # 用户停留时长
            self.user_interests = Counter()  # 用户兴趣关键词
            
            # 最近一次更新时间
            self.last_update = datetime.now()
    
    def _calculate_rates(self):
        """后台线程：计算各种变化率"""
        while True:
            time.sleep(30)  # 每30秒计算一次
            with self.lock:
                # 计算流量变化率
                if len(self.traffic_history) >= 2:
                    # 计算最近10分钟的流量变化率
                    now = datetime.now()
                    cutoff_time = now - timedelta(minutes=10)
                    
                    # 过滤出10分钟内的数据
                    recent_data = [(ts, count) for ts, count in zip(self.traffic_timestamps, self.traffic_history) 
                                  if ts >= cutoff_time]
                    
                    if len(recent_data) >= 2:
                        # 计算线性回归斜率作为变化率
                        x = [(ts - cutoff_time).total_seconds() for ts, _ in recent_data]
                        y = [count for _, count in recent_data]
                        
                        if len(x) > 1:  # 确保有足够的数据点
                            slope, _ = np.polyfit(x, y, 1)
                            self.traffic_rate = slope * 60  # 转换为每分钟变化率
    
    def update_stats(self, interaction_data, user_profile=None):
        """更新统计数据"""
        with self.lock:
            user_id = interaction_data.get('user_id', '')
            behavior = interaction_data.get('interaction', '')
            timestamp = datetime.fromisoformat(interaction_data.get('timestamp'))
            comment = interaction_data.get('comment')
            
            # 更新最近一次更新时间
            self.last_update = timestamp
            
            # 用户分类处理
            is_guest = user_id.startswith('游客_')
            if is_guest:
                self.guest_users.add(user_id)
            else:
                self.registered_users.add(user_id)
            
            # 总用户集合
            self.total_users.add(user_id)
            
            # 处理用户行为
            if behavior == 'enter':
                self.current_users.add(user_id)
                
                # 更新流量历史
                self.traffic_history.append(len(self.current_users))
                self.traffic_timestamps.append(timestamp)
                
                # 保留最近30个数据点
                if len(self.traffic_history) > 30:
                    self.traffic_history.pop(0)
                    self.traffic_timestamps.pop(0)
                
            elif behavior == 'exit':
                if user_id in self.current_users:
                    self.current_users.remove(user_id)
                
                # 更新流量历史
                self.traffic_history.append(len(self.current_users))
                self.traffic_timestamps.append(timestamp)
                
            elif behavior == 'like':
                self.total_likes += 1
                
            elif behavior == 'share':
                self.total_shares += 1
                
            elif behavior == 'comment' and comment:
                self.comments.append({
                    'user_id': user_id,
                    'content': comment,
                    'timestamp': timestamp
                })
                self.comment_counter[comment] += 1
                
                # 分析评论中的关键词
                keywords = self._extract_keywords(comment)
                for kw in keywords:
                    self.user_interests[kw] += 1
            
            # 更新用户停留时长
            if user_id in self.current_users:
                stay_duration = interaction_data.get('stay_duration', 0)
                self.stay_duration[user_id] = stay_duration
            
            # 处理用户画像数据
            if user_profile and not is_guest:
                # 提取用户标签
                if 'behavior' in user_profile:
                    spending = user_profile['behavior'].get('avg_spending', 0)
                    if spending > 10000:
                        self.user_tags['高消费'] += 1
                    elif spending > 5000:
                        self.user_tags['中高消费'] += 1
                    
                    # 分析用户偏好类别
                    categories = user_profile['behavior'].get('preferred_categories', [])
                    for category in categories:
                        if category:
                            self.user_tags[f'偏好_{category}'] += 1
                
                # 分析流量来源
                if 'basic' in user_profile and user_profile['basic'].get('registration'):
                    source = user_profile['basic'].get('registration')
                    if source:
                        self.traffic_sources[source] += 1
    
    def _extract_keywords(self, text):
        """从文本中提取关键词"""
        if not text:
            return []
            
        # 简单实现：按空格分词并过滤常见词
        common_words = {'这个', '有没有', '什么', '怎么', '可以', '吗', '啊', '呢', '的', '了', '是', '我', '你', '他', '她', '它', '们'}
        words = [w for w in text.split() if w not in common_words and len(w) > 1]
        
        # 返回所有可能的关键词
        return words
    
    def get_stats(self):
        """获取当前统计数据"""
        with self.lock:
            # 计算热门评论TOP3
            top_comments = self.comment_counter.most_common(3)
            
            # 计算老客户占比和停留时长
            old_customers = [uid for uid in self.current_users if not uid.startswith('游客_')]
            old_customer_ratio = len(old_customers) / len(self.current_users) if self.current_users else 0
            
            long_stay_users = [uid for uid, duration in self.stay_duration.items() 
                              if duration >= 300 and uid in self.current_users]  # 停留超过5分钟的用户
            long_stay_ratio = len(long_stay_users) / len(self.current_users) if self.current_users else 0
            
            # 构建统计结果
            stats = {
                # 基础用户指标
                'total_users_ever': len(self.total_users),
                'current_users': len(self.current_users),
                'guest_users': len([u for u in self.current_users if u.startswith('游客_')]),
                'registered_users': len([u for u in self.current_users if not u.startswith('游客_')]),
                'total_likes': self.total_likes,
                'total_shares': self.total_shares,
                'total_comments': len(self.comments),
                'top_comments': [{'content': comment, 'count': count} for comment, count in top_comments],
                'traffic_rate': self.traffic_rate,  # 每分钟变化率
                
                # 高级分析指标
                'traffic_sources': dict(self.traffic_sources.most_common(5)),
                'user_tags': dict(sorted(self.user_tags.items(), key=lambda x: x[1], reverse=True)[:5]),
                'old_customer_ratio': round(old_customer_ratio * 100, 2),
                'long_stay_ratio': round(long_stay_ratio * 100, 2),
                'user_interests': dict(self.user_interests.most_common(5)),
                
                # 时间戳
                'timestamp': self.last_update.isoformat(),
                
                # 实时数据可视化
                'traffic_history': self.traffic_history[-10:],  # 最近10个数据点
                'traffic_timestamps': [ts.isoformat() for ts in self.traffic_timestamps[-10:]]
            }
            
            # 生成话术推荐
            stats['script_recommendations'] = self._generate_recommendations(stats)
            
            return stats
    
    def _generate_recommendations(self, stats):
        """根据统计数据生成话术推荐"""
        recommendations = []
        
        # 根据用户构成推荐
        if stats['guest_users'] > stats['registered_users'] * 2:
            recommendations.append("游客占比高，建议增加品牌介绍和会员福利引导")
        
        # 根据互动情况推荐
        if stats['total_comments'] > 0 and stats['total_likes'] / stats['total_comments'] < 2:
            recommendations.append("评论活跃但点赞较少，建议增加互动引导和点赞激励")
        
        # 根据用户兴趣推荐
        if stats['user_interests']:
            top_interest = list(stats['user_interests'].keys())[0] if stats['user_interests'] else None
            if top_interest:
                recommendations.append(f"用户关注'{top_interest}'较多，建议围绕此话题展开介绍")
        
        # 根据流量变化推荐
        if stats['traffic_rate'] < -2:  # 每分钟减少2人以上
            recommendations.append("用户流失率较高，建议推出限时优惠或展示爆款商品")
        
        # 根据停留时长推荐
        if stats['long_stay_ratio'] > 50 and stats['old_customer_ratio'] > 50:
            recommendations.append("老客户占比高且停留时间长，建议介绍新品或会员专享商品")
        
        return recommendations

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

# 添加到现有代码中
@app.route('/api/live-stats', methods=['GET'])
def get_live_stats():
    """获取直播间实时统计数据的API端点"""
    stats = live_room_stats.get_stats()
    return jsonify(stats)

# 添加定时推送统计数据的功能
def _stats_broadcast_task():
    """定时广播统计数据的后台任务"""
    while True:
        try:
            # 获取最新统计
            stats = live_room_stats.get_stats()
            
            # 推送到SSE
            announcer.announce(f"event: stats\ndata: {json.dumps(stats)}\n\n")
            
            # 每10秒推送一次
            time.sleep(10)
        except Exception as e:
            print(f"Stats broadcast error: {str(e)}")
            time.sleep(10)  # 出错后等待10秒再试

# 添加重置统计的API
@app.route('/api/reset-stats', methods=['POST'])
def reset_live_stats():
    """重置直播间统计数据"""
    live_room_stats.reset_stats()
    return jsonify({'status': 'success', 'message': 'Statistics have been reset'})

# 添加特定事件检测和提醒功能
@app.route('/api/alert-conditions', methods=['GET'])
def get_alert_conditions():
    """获取当前可能需要注意的直播间状况"""
    stats = live_room_stats.get_stats()
    alerts = []
    
    # 检测流量突变
    if abs(stats['traffic_rate']) > 5:  # 每分钟变化超过5人
        direction = "增加" if stats['traffic_rate'] > 0 else "减少"
        alerts.append({
            'type': 'traffic_change',
            'severity': 'high',
            'message': f"直播间流量正在快速{direction}，每分钟{abs(stats['traffic_rate']):.1f}人"
        })
    
    # 检测用户兴趣变化
    if stats['user_interests'] and list(stats['user_interests'].keys())[0] != '':
        top_interest = list(stats['user_interests'].keys())[0]
        alerts.append({
            'type': 'interest_shift',
            'severity': 'medium',
            'message': f"用户对'{top_interest}'话题表现出高度兴趣"
        })
    
    # 检测重要客户
    vip_count = sum(1 for tag, count in stats['user_tags'].items() if '高消费' in tag)
    if vip_count > 0:
        alerts.append({
            'type': 'vip_presence',
            'severity': 'high',
            'message': f"当前有{vip_count}位高消费用户在线"
        })
    
    # 检测用户停留情况
    if stats['long_stay_ratio'] > 70:
        alerts.append({
            'type': 'engagement',
            'severity': 'positive',
            'message': f"用户参与度高，{stats['long_stay_ratio']}%的用户停留超过5分钟"
        })
    
    return jsonify({
        'alerts': alerts,
        'timestamp': datetime.now().isoformat(),
        'recommendations': stats['script_recommendations']
    })

# 初始化直播间统计实例
live_room_stats = LiveRoomStats()
# 启动统计广播线程
Thread(target=_stats_broadcast_task, daemon=True).start()

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
            
            # 更新统计数据
            live_room_stats.update_stats(live_data, profile_data)

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

def generate_script_id():
    """生成随机的script_id"""
    return f"script_{uuid.uuid4().hex[:12]}"

@app.route('/api/insert_live_script', methods=['POST'])
def insert_live_script():
    try:
        data = request.json
        
        # 生成随机script_id
        script_id = generate_script_id()
        
        # 准备插入主表的数据
        script_data = {
            'script_id': script_id,
            'product_category_name': data.get('product_category').get('name'),
            'product_positioning': data.get('product_category').get('positioning'),
            'target_audience': data.get('product_category').get('target_audience'),
            'script_type': data.get('script_style').get('type'),
            'script_characteristics': data.get('script_style').get('characteristics'),
            'script_text': data.get('script_text', '')
        }
        
        # 插入主表
        sql = """
        INSERT INTO bailian_data_live_script 
        (script_id, product_category_name, product_positioning, target_audience, script_type, script_characteristics, script_text)
        VALUES (%(script_id)s, %(product_category_name)s, %(product_positioning)s, %(target_audience)s, %(script_type)s, %(script_characteristics)s, %(script_text)s)
        """
        _execute_sql(sql, script_data)
        return jsonify({
            'success': True,
            'message': 'Live script inserted successfully',
            'script_id': script_id
        }), 201
    
    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'Error inserting live script: {str(e)}'
        }), 500

@app.route('/api/insert_live_script_content', methods=['POST'])
def insert_live_script_content():
    try:
        data = request.json
        script_array = data.get('script_array')
        script_id = data.get('script_id')
        # 检查script_id是否存在
        conn = POOL.connection()
        with conn.cursor() as cursor:
            cursor.execute("SELECT script_id FROM bailian_data_live_script WHERE script_id = %s", (script_id,))
            if not cursor.fetchone():
                return jsonify({
                    'success': False,
                    'message': f'script_id {script_id} does not exist in the main table'
                }), 404
        
        # 批量插入内容
        inserted_count = 0
        for item in script_array:
            content_data = {
                'script_id': script_id,
                'section_type': item.get('section_type', ''),
                'original_text': item.get('original_text', ''),
                'element_tag': item.get('element_tag', ''),
                'sequence': item.get('sequence', 0)
            }
            
            sql = """
            INSERT INTO bailian_data_live_script_content 
            (script_id, section_type, original_text, element_tag, sequence)
            VALUES (%(script_id)s, %(section_type)s, %(original_text)s, %(element_tag)s, %(sequence)s)
            """
            _execute_sql(sql, content_data)
            inserted_count += 1
        
        return jsonify({
            'success': True,
            'message': f'Successfully inserted {inserted_count} content items',
            'script_id': script_id
        }), 201
    
    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'Error inserting live script content: {str(e)}'
        }), 500

@app.route('/api/script_content/stats', methods=['GET'])
def get_script_content_stats():
    try:
        # 从连接池获取连接
        conn = POOL.connection()
        cursor = conn.cursor()
        
        # SQL查询 - 统计每个sequence下最常见的section_type和element_tag
        sql = """
        WITH sequence_stats AS (
            SELECT 
                sequence,
                section_type,
                element_tag,
                ROW_NUMBER() OVER (PARTITION BY sequence ORDER BY COUNT(*) DESC) as rn
            FROM 
                bailian_data_live_script_content
            GROUP BY 
                sequence, section_type, element_tag
        ),
        example_texts AS (
            SELECT 
                s.sequence,
                s.section_type,
                s.element_tag,
                c.original_text,
                ROW_NUMBER() OVER (PARTITION BY s.sequence, s.section_type, s.element_tag ORDER BY c.id) as text_rn
            FROM 
                sequence_stats s
            JOIN 
                bailian_data_live_script_content c
                ON s.sequence = c.sequence 
                AND s.section_type = c.section_type 
                AND (s.element_tag = c.element_tag OR (s.element_tag IS NULL AND c.element_tag IS NULL))
            WHERE 
                s.rn = 1
        )
        SELECT 
            s.sequence,
            s.section_type,
            s.element_tag,
            e.original_text as example_text
        FROM 
            sequence_stats s
        JOIN 
            example_texts e
            ON s.sequence = e.sequence 
            AND s.section_type = e.section_type 
            AND (s.element_tag = e.element_tag OR (s.element_tag IS NULL AND e.element_tag IS NULL))
        WHERE 
            s.rn = 1
            AND e.text_rn = 1
        ORDER BY 
            s.sequence;
        """
        
        cursor.execute(sql)
        results = cursor.fetchall()
        
        # 关闭游标和连接
        cursor.close()
        conn.close()
        
        # 处理结果
        stats = []
        for row in results:
            stats.append({
                'most_common_section_type': row['section_type'],
                'most_common_element_tag': row['element_tag'],
                'sequence': row['sequence'],
                'example_text': row['example_text']
            })
        
        return jsonify({
            'status': 'success',
            'data': stats,
            'total': len(stats)
        })
    
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500

@app.route('/api/get_script', methods=['POST'])
def get_script():
    try:
        # 获取请求体中的JSON数据
        data = request.get_json()
        
        # 检查是否提供了script_id
        if not data or 'script_id' not in data:
            return jsonify({
                'status': 'error',
                'message': 'Missing script_id parameter'
            }), 400
        
        script_id = data['script_id']
        
        # 从连接池获取数据库连接
        conn = POOL.connection()
        cursor = conn.cursor()
        
        try:
            # 执行查询
            query = """
                SELECT script_text 
                FROM bailian_data_live_script 
                WHERE id = %s 
                LIMIT 1
            """
            cursor.execute(query, (script_id,))
            result = cursor.fetchone()
            
            if result:
                return jsonify({
                    'status': 'success',
                    'data': result
                })
            else:
                return jsonify({
                    'status': 'error',
                    'message': f'No script found with script_id: {script_id}'
                }), 404
                
        finally:
            # 关闭游标和连接
            cursor.close()
            conn.close()
            
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500



if __name__ == '__main__':

    app.run(host='0.0.0.0', port=5000, debug=False, threaded=True)