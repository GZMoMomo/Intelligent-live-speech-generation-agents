import React, { useState, useEffect, useRef } from 'react';
import 'bootstrap/dist/css/bootstrap.min.css';
import ReactPlayer from 'react-player';
import { Line } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend } from 'chart.js';
import './LiveStreamPage.css';

// 注册Chart.js组件
ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

const MAX_MESSAGES = 8; // 最多显示8条消息

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
    script_recommendations: []
  });
  const [alerts, setAlerts] = useState([]);
  const messagesContainerRef = useRef(null);
  const eventSourceRef = useRef(null);
  const statsEventSourceRef = useRef(null);

  useEffect(() => {
    // 启动后端批量任务
    fetch('http://localhost:5000/api/batch-control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'start',
        interval: 1,
        count: 999999
      }),
    });

    // 建立SSE连接 - 用户互动
    eventSourceRef.current = new EventSource('http://localhost:5000/api/stream');
    
    eventSourceRef.current.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
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
    
    // 建立SSE连接 - 统计数据
    statsEventSourceRef.current = new EventSource('http://localhost:5000/api/stream');
    
    statsEventSourceRef.current.addEventListener('stats', (event) => {
      try {
        const stats = JSON.parse(event.data);
        setLiveStats(stats);
      } catch (error) {
        console.error('Error parsing stats data:', error);
      }
    });
    
    // 定期获取警报信息
    const alertsInterval = setInterval(() => {
      fetch('http://localhost:5000/api/alert-conditions')
        .then(res => res.json())
        .then(data => {
          setAlerts(data.alerts);
        })
        .catch(err => console.error('Error fetching alerts:', err));
    }, 15000);

    return () => {
      eventSourceRef.current?.close();
      statsEventSourceRef.current?.close();
      clearInterval(alertsInterval);
      
      fetch('http://localhost:5000/api/batch-control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' }),
      });
    };
  }, []);

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
  
  // 话术推荐渲染
  const renderScriptRecommendations = () => {
    const recommendations = liveStats.script_recommendations || [];
    return recommendations.map((rec, index) => (
      <div key={index} className="recommendation-item">
        <div className="recommendation-number">{index + 1}</div>
        <div className="recommendation-text">{rec}</div>
      </div>
    ));
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
              <div className="live-metrics">
                <span className="metric-item">
                  <i className="bi bi-person-fill"></i> {liveStats.current_users}
                </span>
                <span className="metric-item">
                  <i className="bi bi-heart-fill"></i> {liveStats.total_likes}
                </span>
                <span className="metric-item">
                  <i className="bi bi-chat-fill"></i> {liveStats.total_comments}
                </span>
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
                    {msg.user && !msg.user.basic.gender?.startsWith('游客') && (
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
                  <span className="badge bg-info">老客户比例: {liveStats.old_customer_ratio}%</span>
                </div>
                <div className="stat-badge">
                  <span className="badge bg-success">长时停留: {liveStats.long_stay_ratio}%</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 右侧面板 - 话术建议 */}
        <div className="side-panel col-lg-4 p-3">
          <div className="stats-container h-100 bg-light rounded-3 p-3">
            <h4 className="stats-header">主播话术建议</h4>
            
            <div className="script-recommendations mb-4">
              <h5>实时话术推荐</h5>
              <div className="recommendations-container">
                {renderScriptRecommendations()}
              </div>
            </div>
            
            <div className="audience-insights mb-4">
              <h5>用户需求洞察</h5>
              <div className="insight-item">
                <div className="insight-icon">🔍</div>
                <div className="insight-content">
                  <h6>热门关键词</h6>
                  <div className="keywords-container">
                    {Object.entries(liveStats.user_interests || {}).slice(0, 3).map(([keyword, count], idx) => (
                      <div key={idx} className="keyword-item">
                        <span className="keyword">{keyword}</span>
                        <span className="keyword-count">{count}次</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              
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
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LiveStreamPage;