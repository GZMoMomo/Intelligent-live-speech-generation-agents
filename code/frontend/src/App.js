import React, { useState, useEffect, useRef } from 'react';
import 'bootstrap/dist/css/bootstrap.min.css';
import ReactPlayer from 'react-player';
import { Line } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend } from 'chart.js';
import './LiveStreamPage.css';
import ReactMarkdown from 'react-markdown'; // 引入Markdown渲染组件
import rehypeRaw from 'rehype-raw'; // 用于支持HTML渲染

// 注册Chart.js组件
ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

const MAX_MESSAGES = 8; // 最多显示8条消息
const API_BASE_URL = 'http://localhost:5000/api';

const LiveStreamPage = () => {
  const [messages, setMessages] = useState([]);
  const [liveStats, setLiveStats] = useState({
    current_users: 0,
    guest_users: 0,
    registered_users: 0,
    total_likes: 0,
    total_shares: 0,
    total_comments: 0,
    top_comments: [],
    traffic_rate: 0,
    traffic_history: [],
    traffic_timestamps: [],
    user_tags: {},
    user_interests: {},
    script_recommendations: [],
    old_customer_ratio: 0,
    long_stay_ratio: 0,
    // 新增用户画像统计数据
    male_percentage: 0,
    female_percentage: 0,
    average_age: 0,
    top_member_level: null,
    top_member_level_count: 0,
    average_spending: 0,
    average_discount_sensitivity: 0,
    top_category_preference: null,
    top_category_preference_count: 0,
    top_comment_sentiment: null,
    top_comment_sentiment_count: 0,
    top_lifestyle_inference: null,
    top_lifestyle_inference_count: 0,
    top_demand_identification: null,
    top_demand_identification_count: 0,
    top_personality_analysis: null,
    top_personality_analysis_count: 0,
    top_purchase_decision_pattern: null,
    top_purchase_decision_pattern_count: 0,
    top_price_tolerance_level: null,
    top_price_tolerance_level_count: 0
  });
  const [alerts, setAlerts] = useState([]);
  const [scriptId, setScriptId] = useState(42); // 默认值为42
  const [aiResponses, setAiResponses] = useState({}); // 存储AI返回的话术
  const messagesContainerRef = useRef(null);
  const eventSourceRef = useRef(null);

  useEffect(() => {
    // 启动后端批量任务
    fetch(`${API_BASE_URL}/batch-control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'start',
        interval: 1,
        count: 999999
      }),
    });

    // 设置script_id
    fetch(`${API_BASE_URL}/set-script-id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script_id: scriptId }),
    });

    // 建立SSE连接
    eventSourceRef.current = new EventSource(`${API_BASE_URL}/stream`);
    
    // 用户互动事件处理
    eventSourceRef.current.onmessage = (event) => {
      try {
        const sanitizedData = event.data.replace(/: ?NaN/g, ': null')
        const data = JSON.parse(sanitizedData);
        const { live_interaction, user_profile } = data;
        
        if (!live_interaction) return;
        
        const userId = live_interaction.user_id;
        const userName = user_profile ? 
          `${userId.substring(0, 8)}${user_profile.basic.member_level ? `(${user_profile.basic.member_level})` : ''}` : 
          userId.substring(0, 8);

        let message = '';
        let icon = '';
        
        switch(live_interaction.interaction) {
          case 'enter':
            message = `${userName} 进入直播间`;
            icon = '👋';
            break;
          case 'exit':
            message = `${userName} 离开直播间`;
            icon = '👋';
            break;
          case 'comment':
            message = `${userName}: ${live_interaction.comment}`;
            icon = '💭';
            break;
          case 'like':
            message = `${userName} 点赞`;
            icon = '❤️';
            break;
          case 'share':
            message = `${userName} 分享了直播`;
            icon = '🔄';
            break;
          default:
            break;
        }

        if (message) {
          setMessages(prev => {
            const newMessages = [...prev, {
              id: Date.now(),
              text: message,
              icon: icon,
              type: live_interaction.interaction,
              user: user_profile
            }];
            return newMessages.slice(-MAX_MESSAGES);
          });
        }
      } catch (error) {
        console.error('Error parsing SSE data:', error);
      }
    };
    
    // 添加对stats事件的监听
    eventSourceRef.current.addEventListener('stats', (event) => {
      try {
        const data = JSON.parse(event.data);
        setLiveStats(data);
      } catch (error) {
        console.error('Error parsing stats data:', error);
      }
    });

    // 添加对script_recommendation事件的监听
    eventSourceRef.current.addEventListener('script_recommendation', (event) => {
      try {
        const data = JSON.parse(event.data);

        setAiResponses(prev => {
          const streamId = data.stream_id;  // 使用后端生成的流ID
          const original = data.original_recommendation;
      
          return {
            ...prev,
            [original]: {
              streamId,  // 存储流ID用于key生成
              text: (prev[original]?.text || '') + (data.data || ''),
              complete: data.is_end
            }
          };
        });

        console.log('收到script_recommendation事件:', data); // 添加日志
        
        // 确保有必要的字段
        if (!data.original_recommendation) {
          console.error('缺少original_recommendation字段:', data);
          return;
        }
        
        setAiResponses(prev => {
          const originalRecommendation = data.original_recommendation;
          const currentText = prev[originalRecommendation]?.text || '';
          const isComplete = data.is_end || false;
          const newText = isComplete ? currentText : currentText + (data.data || '');
          
          console.log(`更新话术 [${originalRecommendation}]: ${newText}`);
          
          return {
            ...prev,
            [originalRecommendation]: {
              text: newText,
              complete: isComplete
            }
          };
        });
      } catch (error) {
        console.error('Error parsing script recommendation data:', error);
      }
    });
    
    
    // 定期获取警报信息
    const alertsInterval = setInterval(() => {
      fetch(`${API_BASE_URL}/alert-conditions`)
        .then(res => res.json())
        .then(data => {
          setAlerts(data.alerts);
        })
        .catch(err => console.error('Error fetching alerts:', err));
    }, 2000);

    return () => {
      eventSourceRef.current?.close();
      clearInterval(alertsInterval);
      
      fetch(`${API_BASE_URL}/batch-control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' }),
      });
    };
  }, [scriptId]); // 添加scriptId作为依赖项

  // 当scriptId变更时，更新后端设置
  const handleScriptIdChange = (e) => {
    const newId = parseInt(e.target.value) || 42; // 如果无法解析为整数，则使用默认值42
    setScriptId(newId);
    
    // 发送到后端
    fetch(`${API_BASE_URL}/set-script-id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script_id: newId }),
    });
  };

  // 自动滚动消息到底部
  useEffect(() => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  }, [messages]);
  
  // 流量图表配置
  const trafficChartData = {
    labels: liveStats.traffic_timestamps?.map(ts => {
      const date = new Date(ts);
      return `${date.getHours()}:${date.getMinutes().toString().padStart(2, '0')}`;
    }) || [],
    datasets: [
      {
        label: '直播间人数',
        data: liveStats.traffic_history || [],
        fill: false,
        backgroundColor: 'rgba(75, 192, 192, 0.2)',
        borderColor: 'rgba(75, 192, 192, 1)',
        tension: 0.4
      }
    ]
  };
  
  const trafficChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top',
      },
      title: {
        display: true,
        text: '直播间流量趋势'
      }
    },
    scales: {
      y: {
        beginAtZero: true
      }
    }
  };
  
  // 用户标签渲染
  const renderUserTags = () => {
    const tags = liveStats.user_tags || {};
    return Object.entries(tags).map(([tag, count], index) => (
      <span key={index} className="badge bg-info me-2 mb-2">
        {tag}: {count}
      </span>
    ));
  };
  
  // 用户兴趣渲染
  const renderUserInterests = () => {
    const interests = liveStats.user_interests || {};
    return Object.entries(interests).map(([interest, count], index) => (
      <span key={index} className="badge bg-warning text-dark me-2 mb-2">
        {interest}: {count}
      </span>
    ));
  };
  
  // 热门评论渲染
  const renderTopComments = () => {
    const comments = liveStats.top_comments || [];
    return comments.map((comment, index) => (
      <div key={index} className="top-comment">
        <span className="comment-badge">{index + 1}</span>
        <span className="comment-content">{comment.content}</span>
        <span className="comment-count">({comment.count}次)</span>
      </div>
    ));
  };

  // 简单哈希函数（生产环境建议使用更复杂算法）
  const hashCode = str => {
    let hash = 0;
    if (str.length === 0) return hash;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0; // 转换为32位整数
    }
    return hash;
  };

  // 话术推荐渲染 
  const renderScriptRecommendations = () => {
    const recommendations = liveStats.script_recommendations || [];
    
    // 添加日志，帮助调试
    console.log('话术推荐列表:', recommendations);
    console.log('AI响应状态:', aiResponses);
    
    if (recommendations.length === 0) {
      // 检查aiResponses是否有内容
      const aiResponseKeys = Object.keys(aiResponses);
      if (aiResponseKeys.length > 0) {
        // 如果有AI响应但没有推荐列表，使用AI响应的键作为推荐列表
        return (
          <div className="recommendations-scroll-container">
            {recommendations.map((rec, index) => {
              const aiData = aiResponses[rec] || { text: '', complete: false };
              // 生成唯一 key 的三种策略（按优先级降序）
              const key = 
                // 策略一：优先使用后端生成的唯一标识（需要后端支持）
                aiResponses[rec]?.streamId || 
                // 策略二：使用特征哈希（推荐即时方案）
                `rec-${hashCode(rec)}-${scriptId}` ||
                // 策略三：降级方案（时间戳+随机数）
                `rec-fallback-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;

              return (
                <div key={key} className="recommendation-item">
                  <div className="recommendation-number">{index + 1}</div>
                  <div className="recommendation-text">
                    <div className="original-recommendation">{rec}</div>
                    {aiData.text && (
                      <div className="ai-recommendation">
                        <div className="ai-badge">AI话术:</div>
                        <div className="ai-text-container">
                          <ReactMarkdown rehypePlugins={[rehypeRaw]}>
                            {aiData.text}
                          </ReactMarkdown>
                          {!aiData.complete && <span className="typing-cursor">|</span>}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        );
      }
      
      return (
        <div className="empty-recommendations">
          <p>暂无话术推荐</p>
        </div>
      );
    }
    
    return (
      <div className="recommendations-scroll-container">
        {recommendations.map((rec, index) => {
          const aiData = aiResponses[rec] || { text: '', complete: false };
          
          return (
            <div key={`recommendation-${index}-${rec}`} className="recommendation-item">
              <div className="recommendation-number">{index + 1}</div>
              <div className="recommendation-text">
                <div className="original-recommendation">{rec}</div>
                {aiData.text && (
                  <div className="ai-recommendation">
                    <div className="ai-badge">AI话术:</div>
                    <div className="ai-text-container">
                      <ReactMarkdown rehypePlugins={[rehypeRaw]}>
                        {aiData.text}
                      </ReactMarkdown>
                      {!aiData.complete && <span className="typing-cursor">|</span>}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };
  
  // 警报渲染
  const renderAlerts = () => {
    return alerts.map((alert, index) => {
      let alertClass = "alert ";
      switch(alert.severity) {
        case 'high':
          alertClass += "alert-danger";
          break;
        case 'medium':
          alertClass += "alert-warning";
          break;
        case 'positive':
          alertClass += "alert-success";
          break;
        default:
          alertClass += "alert-info";
      }
      
      return (
        <div key={index} className={alertClass}>
          <strong>{alert.type === 'traffic_change' ? '⚠️ ' : '📊 '}</strong>
          {alert.message}
        </div>
      );
    });
  };

  return (
    <div className="main-container container-fluid">
      <div className="row g-0 h-100">
        {/* 左侧面板 - 数据统计 */}
        <div className="side-panel col-lg-4 p-3">
          <div className="stats-container h-100 bg-light rounded-3 p-3">
            <h4 className="stats-header">直播间实时数据</h4>
            
            <div className="user-stats mb-4">
              <h5>用户统计</h5>
              <div className="stats-row">
                <div className="stat-item">
                  <div className="stat-value">{liveStats.current_users}</div>
                  <div className="stat-label">当前用户</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{liveStats.guest_users}</div>
                  <div className="stat-label">游客用户</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{liveStats.registered_users}</div>
                  <div className="stat-label">注册用户</div>
                </div>
              </div>
            </div>
            
            <div className="interaction-stats mb-4">
              <h5>互动统计</h5>
              <div className="stats-row">
                <div className="stat-item">
                  <div className="stat-value">{liveStats.total_likes}</div>
                  <div className="stat-label">点赞数</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{liveStats.total_shares}</div>
                  <div className="stat-label">分享数</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{liveStats.total_comments}</div>
                  <div className="stat-label">评论数</div>
                </div>
              </div>
            </div>
            
            <div className="traffic-chart mb-4">
              <h5>流量趋势</h5>
              <div className="chart-container" style={{ height: '200px' }}>
                <Line data={trafficChartData} options={trafficChartOptions} />
              </div>
              <div className="traffic-rate mt-2">
                <span className={`badge ${liveStats.traffic_rate > 0 ? 'bg-success' : liveStats.traffic_rate < 0 ? 'bg-danger' : 'bg-secondary'}`}>
                  流量变化率: {liveStats.traffic_rate > 0 ? '+' : ''}{liveStats.traffic_rate.toFixed(2)}/分钟
                </span>
              </div>
            </div>
            
            <div className="audience-analysis mb-4">
              <h5>用户画像分析</h5>
              <div className="user-tags mb-2">
                <h6>用户标签:</h6>
                <div>{renderUserTags()}</div>
              </div>
              <div className="user-interests">
                <h6>用户兴趣:</h6>
                <div>{renderUserInterests()}</div>
              </div>
            </div>
            
            <div className="user-profile-stats mb-4">
              <h5>用户画像统计</h5>
              
              {/* 性别比例 */}
              <div className="profile-stat-item mb-3">
                <h6>性别比例</h6>
                <div className="progress" style={{ height: '20px' }}>
                  <div 
                    className="progress-bar bg-primary" 
                    role="progressbar" 
                    style={{ width: `${liveStats.male_percentage || 0}%` }}
                    aria-valuenow={liveStats.male_percentage || 0} 
                    aria-valuemin="0" 
                    aria-valuemax="100">
                    男 {Math.round(liveStats.male_percentage || 0)}%
                  </div>
                  <div 
                    className="progress-bar bg-danger" 
                    role="progressbar" 
                    style={{ width: `${liveStats.female_percentage || 0}%` }}
                    aria-valuenow={liveStats.female_percentage || 0} 
                    aria-valuemin="0" 
                    aria-valuemax="100">
                    女 {Math.round(liveStats.female_percentage || 0)}%
                  </div>
                </div>
              </div>
              
              {/* 年龄和消费能力 */}
              <div className="profile-stats-row d-flex justify-content-between mb-3">
                <div className="profile-stat-card">
                  <div className="stat-title">平均年龄</div>
                  <div className="stat-value">{liveStats.average_age?.toFixed(1) || '未知'}</div>
                </div>
                <div className="profile-stat-card">
                  <div className="stat-title">平均消费</div>
                  <div className="stat-value">¥{liveStats.average_spending?.toFixed(0) || 0}</div>
                </div>
                <div className="profile-stat-card">
                  <div className="stat-title">折扣敏感度</div>
                  <div className="stat-value">{liveStats.average_discount_sensitivity?.toFixed(1) || 0}%</div>
                </div>
              </div>
              
              {/* 会员等级和品类偏好 */}
              <div className="profile-stats-row mb-3">
                <div className="d-flex justify-content-between">
                  <div className="profile-stat-tag">
                    <span className="stat-label">主要会员等级:</span>
                    <span className="stat-badge bg-gold">{liveStats.top_member_level || '未知'}</span>
                    <span className="stat-count">({liveStats.top_member_level_count || 0}人)</span>
                  </div>
                  <div className="profile-stat-tag">
                    <span className="stat-label">品类偏好:</span>
                    <span className="stat-badge bg-info">{liveStats.top_category_preference || '未知'}</span>
                    <span className="stat-count">({liveStats.top_category_preference_count || 0}人)</span>
                  </div>
                </div>
              </div>
              
              {/* 用户特征分析 */}
              <div className="profile-insights mb-2">
                <h6>用户特征分析</h6>
                <div className="insights-container">
                  {liveStats.top_personality_analysis && (
                    <div className="insight-badge">
                      <span className="insight-label">性格特征:</span>
                      <span className="insight-value">{liveStats.top_personality_analysis}</span>
                      <span className="insight-count">({liveStats.top_personality_analysis_count || 0})</span>
                    </div>
                  )}
                  {liveStats.top_lifestyle_inference && (
                    <div className="insight-badge">
                      <span className="insight-label">生活方式:</span>
                      <span className="insight-value">{liveStats.top_lifestyle_inference}</span>
                      <span className="insight-count">({liveStats.top_lifestyle_inference_count || 0})</span>
                    </div>
                  )}
                  {liveStats.top_comment_sentiment && (
                    <div className="insight-badge">
                      <span className="insight-label">评论情感:</span>
                      <span className="insight-value">{liveStats.top_comment_sentiment}</span>
                      <span className="insight-count">({liveStats.top_comment_sentiment_count || 0})</span>
                    </div>
                  )}
                </div>
              </div>
              
              {/* 购买决策分析 */}
              <div className="purchase-insights">
                <h6>购买决策分析</h6>
                <div className="insights-container">
                  {liveStats.top_demand_identification && (
                    <div className="insight-badge">
                      <span className="insight-label">主要需求:</span>
                      <span className="insight-value">{liveStats.top_demand_identification}</span>
                      <span className="insight-count">({liveStats.top_demand_identification_count || 0})</span>
                    </div>
                  )}
                  {liveStats.top_purchase_decision_pattern && (
                    <div className="insight-badge">
                      <span className="insight-label">决策模式:</span>
                      <span className="insight-value">{liveStats.top_purchase_decision_pattern}</span>
                      <span className="insight-count">({liveStats.top_purchase_decision_pattern_count || 0})</span>
                    </div>
                  )}
                  {liveStats.top_price_tolerance_level && (
                    <div className="insight-badge">
                      <span className="insight-label">价格承受度:</span>
                      <span className="insight-value">{liveStats.top_price_tolerance_level}</span>
                      <span className="insight-count">({liveStats.top_price_tolerance_level_count || 0})</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="top-comments">
              <h5>热门评论 TOP3</h5>
              {renderTopComments()}
            </div>
          </div>
        </div>

        {/* 直播核心区域 */}
        <div className="col-lg-4 d-flex flex-column">
          {/* 顶部统计 */}
          <div className="top-stats bg-light rounded-3 mb-3 p-3">
            <div className="d-flex justify-content-between align-items-center">
              <div className="live-status">
                <span className="status-indicator"></span> 直播中
              </div>
            </div>
            
            <div className="alerts-container mt-2">
              {renderAlerts()}
            </div>
          </div>

          {/* 视频容器 */}
          <div className="live-viewport-container flex-grow-1">
            <div className="live-viewport">
              <div className="player-wrapper">
                <ReactPlayer
                  url="https://sf1-cdn-tos.huoshanstatic.com/obj/media-fe/xgplayer_doc_video/hls/xgplayer-demo.m3u8"
                  playing
                  controls
                  width="100%"
                  height="100%"
                  style={{ position: 'absolute', top: 0, left: 0 }}
                  config={{ 
                    file: { 
                      forceHLS: true,
                    } 
                  }}
                />
              </div>

              {/* 消息通知 */}
              <div className="messages-overlay" ref={messagesContainerRef}>
                {messages.map(msg => (
                  <div key={msg.id} className={`message-item ${msg.type}`}>
                    <span className="message-icon">{msg.icon}</span>
                    <span className="message-text">{msg.text}</span>
                    {msg.user && (typeof msg.user.basic.gender === 'string' && !msg.user.basic.gender.startsWith('游客')) && (
                      <span className="user-tag">
                        {msg.user.behavior.avg_spending > 5000 ? '💎' : ''}
                        {msg.user.behavior.preferred_categories?.includes('包') ? '👜' : ''}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 底部统计 */}
          <div className="bottom-stats bg-light rounded-3 mt-3 p-3">
            <div className="d-flex justify-content-between">
              <div className="audience-ratio">
                <h6>用户构成</h6>
                <div className="progress" style={{ height: '20px' }}>
                  <div 
                    className="progress-bar bg-primary" 
                    role="progressbar" 
                    style={{ width: `${(liveStats.registered_users / liveStats.current_users * 100) || 0}%` }}
                    aria-valuenow={(liveStats.registered_users / liveStats.current_users * 100) || 0} 
                    aria-valuemin="0" 
                    aria-valuemax="100">
                    注册用户 {Math.round((liveStats.registered_users / liveStats.current_users * 100) || 0)}%
                  </div>
                  <div 
                    className="progress-bar bg-secondary" 
                    role="progressbar" 
                    style={{ width: `${(liveStats.guest_users / liveStats.current_users * 100) || 0}%` }}
                    aria-valuenow={(liveStats.guest_users / liveStats.current_users * 100) || 0} 
                    aria-valuemin="0" 
                    aria-valuemax="100">
                    游客 {Math.round((liveStats.guest_users / liveStats.current_users * 100) || 0)}%
                  </div>
                </div>
              </div>
              <div className="engagement-stats">
                <div className="stat-badge">
                  <span className="badge bg-info">注册用户比例: {liveStats.old_customer_ratio}%</span>
                </div>
                <div className="stat-badge">
                  <span className="badge bg-success">5分钟停留: {liveStats.long_stay_ratio}%</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 右侧面板 - 话术建议 */}
        <div className="side-panel col-lg-4 p-3">
          <div className="stats-container h-100 bg-light rounded-3 p-3">
            <h4 className="stats-header">主播话术建议</h4>
            
            {/* 添加script_id输入框 */}
            <div className="script-id-container mb-3">
              <label htmlFor="scriptId" className="form-label">话术模板ID:</label>
              <div className="input-group">
                <input 
                  type="number" 
                  className="form-control" 
                  id="scriptId" 
                  value={scriptId}
                  onChange={handleScriptIdChange}
                  placeholder="输入话术模板ID"
                />
                <span className="input-group-text">当前ID: {scriptId}</span>
              </div>
              <small className="form-text text-muted">不填写则使用默认模板(ID:42)</small>
            </div>
            
            <div className="script-recommendations mb-4">
              <h5>实时话术推荐</h5>
              <div className="recommendations-container">
                {renderScriptRecommendations()}
              </div>
            </div>
            
            <div className="audience-insights mb-4">
              <h5>用户需求洞察</h5>
              
              <div className="insight-item">
                <div className="insight-icon">👥</div>
                <div className="insight-content">
                  <h6>用户特征</h6>
                  <ul className="user-traits">
                    {liveStats.old_customer_ratio > 50 && (
                      <li>老客户占比高 ({liveStats.old_customer_ratio}%)</li>
                    )}
                    {liveStats.long_stay_ratio > 50 && (
                      <li>停留时长高 ({liveStats.long_stay_ratio}%超过5分钟)</li>
                    )}
                    {Object.entries(liveStats.user_tags || {}).slice(0, 2).map(([tag, count], idx) => (
                      <li key={idx}>{tag}用户较多 ({count}人)</li>
                    ))}
                  </ul>
                </div>
              </div>
              
              {/* 新增用户画像洞察 */}
              <div className="insight-item mt-3">
                <div className="insight-icon">📊</div>
                <div className="insight-content">
                  <h6>用户画像洞察</h6>
                  <ul className="user-traits">
                    {liveStats.male_percentage > 60 && (
                      <li>男性用户占主导 ({Math.round(liveStats.male_percentage)}%)</li>
                    )}
                    {liveStats.female_percentage > 60 && (
                      <li>女性用户占主导 ({Math.round(liveStats.female_percentage)}%)</li>
                    )}
                    {liveStats.average_age > 0 && (
                      <li>平均年龄 {liveStats.average_age.toFixed(1)} 岁</li>
                    )}
                    {liveStats.top_personality_analysis && (
                      <li>主要性格特征: {liveStats.top_personality_analysis}</li>
                    )}
                    {liveStats.top_demand_identification && (
                      <li>主要需求: {liveStats.top_demand_identification}</li>
                    )}
                  </ul>
                </div>
              </div>
            </div>
            
            <div className="product-suggestions">
              <h5>商品推荐策略</h5>
              <div className="strategy-container">
                {liveStats.traffic_rate > 3 && (
                  <div className="strategy-item">
                    <div className="strategy-icon">📈</div>
                    <div className="strategy-content">
                      <h6>流量上升中</h6>
                      <p>建议展示爆款商品，抓住新进用户兴趣</p>
                    </div>
                  </div>
                )}
                
                {liveStats.traffic_rate < -3 && (
                  <div className="strategy-item">
                    <div className="strategy-icon">📉</div>
                    <div className="strategy-content">
                      <h6>流量下降中</h6>
                      <p>建议推出限时优惠或互动抽奖活动</p>
                    </div>
                  </div>
                )}
                
                {liveStats.old_customer_ratio > 60 && (
                  <div className="strategy-item">
                    <div className="strategy-icon">🏆</div>
                    <div className="strategy-content">
                      <h6>老客户较多</h6>
                      <p>建议推荐新品或会员专属优惠</p>
                    </div>
                  </div>
                )}
                
                {liveStats.guest_users > liveStats.registered_users * 1.5 && (
                  <div className="strategy-item">
                    <div className="strategy-icon">🆕</div>
                    <div className="strategy-content">
                      <h6>新客户较多</h6>
                      <p>建议强调品牌故事和产品优势</p>
                    </div>
                  </div>
                )}
                
                {/* 新增基于用户画像的推荐策略 */}
                {liveStats.top_price_tolerance_level === '高' && (
                  <div className="strategy-item">
                    <div className="strategy-icon">💎</div>
                    <div className="strategy-content">
                      <h6>高价格承受度</h6>
                      <p>建议推荐高端产品，强调品质和稀缺性</p>
                    </div>
                  </div>
                )}
                
                {liveStats.top_category_preference && (
                  <div className="strategy-item">
                    <div className="strategy-icon">🔍</div>
                    <div className="strategy-content">
                      <h6>品类偏好: {liveStats.top_category_preference}</h6>
                      <p>建议重点推荐该品类商品，满足用户偏好</p>
                    </div>
                  </div>
                )}
                
                {liveStats.average_discount_sensitivity > 70 && (
                  <div className="strategy-item">
                    <div className="strategy-icon">🏷️</div>
                    <div className="strategy-content">
                      <h6>高折扣敏感度</h6>
                      <p>建议强调折扣力度和限时优惠</p>
                    </div>
                  </div>
                )}
                
                {liveStats.top_purchase_decision_pattern && (
                  <div className="strategy-item">
                    <div className="strategy-icon">🧠</div>
                    <div className="strategy-content">
                      <h6>决策模式: {liveStats.top_purchase_decision_pattern}</h6>
                      <p>建议根据用户决策模式调整销售话术</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LiveStreamPage;