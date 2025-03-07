import json
import threading
from http import HTTPStatus
from dashscope import Application

def test_dashscope_api_streaming():
    """测试DashScope API的流式输出"""
    
    # 模拟推荐内容
    recommendation = "这是一个测试推荐内容"
    script_id = 42
    
    print(f"开始测试API流式输出，推荐内容: {recommendation}, 脚本ID: {script_id}")
    
    try:
        biz_params = {
            "script_id": script_id,
            "broadcast_data": recommendation  
        }
        
        response = Application.call(
                    api_key="sk-5825867b9f004646a7dd9aefd5623aaf",
                    app_id='eacfbfcd378c4306bd475b111bc63884',
            prompt='(请根据当前直播间实时情况和预设话术生成话术推荐)',
            incremental_output=True,
            flow_stream_mode="agent_format",
            stream=True
        )

        print("API调用成功，开始接收流式响应:")
        
        # 处理流式响应
        for i, chunk in enumerate(response):
            if chunk.status_code == HTTPStatus.OK:
                print(f"块 {i+1}:")
                print(f"  状态: {chunk.status_code}")
                print(f"  内容: {chunk.output.text}")
                
                # 构建事件数据示例
                event_data = {
                    "type": "script_recommendation",
                    "data": chunk.output.text,
                    "script_id": script_id,
                    "original_recommendation": recommendation
                }
                print(f"  事件数据: {json.dumps(event_data)}")
                print("---")
            else:
                print(f"API错误: {chunk.message}")
    except Exception as e:
        print(f"API调用异常: {str(e)}")
    finally:
        print("API测试完成")

if __name__ == "__main__":
    test_dashscope_api_streaming()