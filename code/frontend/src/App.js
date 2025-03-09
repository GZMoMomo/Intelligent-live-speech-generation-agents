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
  const [scriptId, setScriptId] = useState(43); // 默认值为42
  const [aiResponses, setAiResponses] = useState({}); // 存储AI返回的话术
  const messagesContainerRef = useRef(null);
  const eventSourceRef = useRef(null);
  const recommendationsContainerRef = useRef(null);
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [activeAlertIndex, setActiveAlertIndex] = useState(0);
  const alertsContainerRef = useRef(null);
  const [question, setQuestion] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [questionResponses, setQuestionResponses] = useState({});
  const questionResponsesContainerRef = useRef(null);
  const [selectedPhase, setSelectedPhase] = useState("开场话术"); // 默认选中“开场话术”
  const [selectedTags, setSelectedTags] = useState([]); // 存储选中的标签
  const alertsIntervalRef = useRef(null);
  const [comment, setComment] = useState('');
  const [commentResponses, setCommentResponses] = useState({});
  const [isCommentSubmitting, setIsCommentSubmitting] = useState(false);
  const commentResponsesContainerRef = useRef(null);

  // 更新话术阶段的函数
  const handlePhaseClick = (phase) => {
    setSelectedPhase(phase);
  };

  // 更新话术标签的函数
  const handleTagClick = (tag) => {
    const updatedTags = selectedTags.includes(tag)
      ? selectedTags.filter((t) => t !== tag) // 移除已选中的标签
      : [...selectedTags, tag]; // 添加未选中的标签
    setSelectedTags(updatedTags);
  };

  // 将数据发送到后端
  const sendRecommendationToBackend = async (phase, tags) => {
    const phaseString = `当前位置：${phase}`;
    const tagsString = tags.length > 0 ? `\n话术风格：${tags.join(", ")}` : "";
    const recommendationString = `${phaseString}${tagsString}`;
  
    try {
      await fetch(`${API_BASE_URL}/update-recommendation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recommendation: recommendationString }),
      });
      console.log('Recommendation updated:', recommendationString);
    } catch (error) {
      console.error('Error updating recommendation:', error);
    }
  };

  // 渲染按钮组
  const renderButtons = () => (
    <div className="button-container">
      {/* 第一排：话术阶段 */}
      <div className="button-row">
        {["开场话术", "转品话术", "营销话术", "种草话术", "转化话术"].map((phase) => (
          <button
            key={phase}
            className={`btn ${selectedPhase === phase ? "btn-primary" : "btn-outline-primary"}`}
            onClick={() => handlePhaseClick(phase)}
          >
            {phase}
          </button>
        ))}
      </div>
  
      {/* 第二排：话术标签 */}
      <div className="button-row mt-2">
        {[
          "挖痛点",
          "说重点",
          "转品理由",
          "转品互动语",
          "竞品优势",
          "客户痛点",
          "精准介绍",
          "情感共鸣",
          "作用功效强调",
          "稀缺性",
          "从众话术",
          "问候语",
          "痛点放大",
          "吸引文案",
          "紧迫感",
          "下单理由",
        ].map((tag) => (
          <button
            key={tag}
            className={`btn ${selectedTags.includes(tag) ? "btn-info" : "btn-outline-info"}`}
            onClick={() => handleTagClick(tag)}
          >
            {tag}
          </button>
        ))}
      </div>
    </div>
  );

  const handleQuestionSubmit = async (e) => {
    e.preventDefault();
    if (!question.trim() || isSubmitting) return;
    
    setIsSubmitting(true);
    
    try {
      const response = await fetch(`${API_BASE_URL}/ask-question`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: question.trim() }),
      });
      
      const data = await response.json();
      
      if (data.status === 'success') {
        // 清空输入框
        setQuestion('');
        // 创建一个新的响应条目
        setQuestionResponses(prev => ({
          ...prev,
          [data.stream_id]: {
            text: '',
            question: question.trim(),
            complete: false,
            streamId: data.stream_id
          }
        }));
      } else {
        console.error('Error submitting question:', data.error);
      }
    } catch (error) {
      console.error('Error submitting question:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBatchControl = async (action) => {
    try {
      await fetch(`${API_BASE_URL}/batch-control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          interval: 0.3,
          count: action === 'start' ? 999999 : 0
        }),
      });
      
      // 控制警报请求的interval
      if (action === 'start') {
        alertsIntervalRef.current = setInterval(() => {
          fetch(`${API_BASE_URL}/alert-conditions`)
            .then(res => res.json())
            .then(data => setAlerts(data.alerts))
            .catch(console.error);
        }, 2000);
      } else {
        clearInterval(alertsIntervalRef.current);
        alertsIntervalRef.current = null;
      }
      
      setIsBatchRunning(action === 'start');
    } catch (error) {
      console.error('Batch control error:', error);
    }
  };
  
  useEffect(() => {
    // 组件加载时启动告警轮询
    alertsIntervalRef.current = setInterval(() => {
      fetch(`${API_BASE_URL}/alert-conditions`)
        .then(res => res.json())
        .then(data => setAlerts(data.alerts))
        .catch(console.error);
    }, 2000);
  
    // 组件卸载时清除
    return () => {
      clearInterval(alertsIntervalRef.current);
      alertsIntervalRef.current = null;
    };
  }, []);

  useEffect(() => {
    sendRecommendationToBackend(selectedPhase, selectedTags);
  }, [selectedPhase, selectedTags]); // 当这两个状态变化时触发

  // 添加自动轮播效果
  useEffect(() => {
    if (alerts.length > 0) {
      const interval = setInterval(() => {
        setActiveAlertIndex(prevIndex => (prevIndex + 1) % alerts.length);
      }, 5000); // 每5秒切换一次
      
      return () => clearInterval(interval);
    }
  }, [alerts.length]);

  // 当新告警出现时，自动滚动到底部
  useEffect(() => {
    if (alertsContainerRef.current && alerts.length > 0) {
      alertsContainerRef.current.scrollTop = alertsContainerRef.current.scrollHeight;
    }
  }, [alerts]);


  useEffect(() => {
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
        const streamId = data.stream_id;
        const originalRecommendation = data.original_recommendation;
        
        // 使用函数式更新，在函数内部检查当前状态
        setAiResponses(prev => {
          // 检查当前状态中是否已有该streamId
          if (!data.is_end && !prev[streamId]) {
            console.log('Creating new stream entry for:', streamId);
            return {
              ...prev,
              [streamId]: { 
                text: data.data || '', 
                recommendation: originalRecommendation,
                complete: false,
                streamId: streamId
              }
            };
          } else {
            // 追加内容
            const existing = prev[streamId] || { 
              text: '', 
              recommendation: originalRecommendation,
              complete: false,
              streamId: streamId
            };
            
            return {
              ...prev,
              [streamId]: {
                ...existing,
                text: data.is_end ? existing.text : existing.text + (data.data || ''),
                complete: data.is_end || false,
                recommendation: originalRecommendation
              }
            };
          }
        });
      } catch (error) {
        console.error('Error parsing script recommendation data:', error);
      }
    });
    
    eventSourceRef.current.addEventListener('comment_reply', (event) => {
      try {
        const data = JSON.parse(event.data);
        const streamId = data.stream_id;
        
        setCommentResponses(prev => {
          const existing = prev[streamId] || { 
            text: '', 
            comment: data.comment,
            complete: false,
            streamId: streamId,
            error: data.error,
            errorMessage: data.message
          };
          
          return {
            ...prev,
            [streamId]: {
              ...existing,
              text: data.is_end ? existing.text : existing.text + (data.data || ''),
              complete: data.is_end || false,
              error: data.error,
              errorMessage: data.message
            }
          };
        });
      } catch (error) {
        console.error('Error parsing comment reply data:', error);
      }
    });

    eventSourceRef.current.addEventListener('question_response', (event) => {
      try {
        const data = JSON.parse(event.data);
        const streamId = data.stream_id;
        
        setQuestionResponses(prev => {
          // 检查当前状态中是否已有该streamId
          if (!data.is_end && !prev[streamId]) {
            return {
              ...prev,
              [streamId]: { 
                text: data.data || '', 
                question: data.question,
                complete: false,
                streamId: streamId,
                error: data.error,
                errorMessage: data.message
              }
            };
          } else {
            // 追加内容
            const existing = prev[streamId] || { 
              text: '', 
              question: data.question,
              complete: false,
              streamId: streamId,
              error: data.error,
              errorMessage: data.message
            };
            
            return {
              ...prev,
              [streamId]: {
                ...existing,
                text: data.is_end ? existing.text : existing.text + (data.data || ''),
                complete: data.is_end || false,
                error: data.error,
                errorMessage: data.message
              }
            };
          }
        });
      } catch (error) {
        console.error('Error parsing question response data:', error);
      }
    });

    return () => {
      eventSourceRef.current?.close();
      // 清理interval
      if (alertsIntervalRef.current) {
        clearInterval(alertsIntervalRef.current);
      }
      
      if (isBatchRunning) {
        fetch(`${API_BASE_URL}/batch-control`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'stop' }),
        });
      }
    };

  }, [scriptId, isBatchRunning]); 

  useEffect(() => {
    if (questionResponsesContainerRef.current) {
      questionResponsesContainerRef.current.scrollTop = questionResponsesContainerRef.current.scrollHeight;
    }
  }, [questionResponses]);

  // 当scriptId变更时，更新后端设置
  const handleScriptIdChange = (e) => {
    const newId = parseInt(e.target.value) || 43; // 如果无法解析为整数，则使用默认值43
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

  useEffect(() => {
    // 当aiResponses更新时，自动滚动到最新内容
    if (recommendationsContainerRef.current) {
      recommendationsContainerRef.current.scrollTop = recommendationsContainerRef.current.scrollHeight;
    }
  }, [aiResponses]);
  
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
    return Object.values(aiResponses).map((response, index) => (
      <div key={response.streamId || index} className="recommendation-item">
        <div className="recommendation-number">{index + 1}</div>
        <div className="recommendation-text">
          {response.text && (
            <div className="ai-recommendation">
              <div className="ai-badge">AI话术:</div>
              <ReactMarkdown rehypePlugins={[rehypeRaw]}>
                {response.text}
              </ReactMarkdown>
              {!response.complete && <span className="typing-cursor">|</span>}
            </div>
          )}
        </div>
      </div>
    ));
  };
  
  // 修改告警渲染函数
  const renderAlerts = () => {
    if (alerts.length === 0) {
      return <div className="text-center text-muted py-3">暂无告警信息</div>;
    }
    
    // 单个告警显示模式（轮播）
    return (
      <>
        <div className="alert-carousel">
          {alerts.map((alert, index) => {
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
              <div 
                key={index} 
                className={`alert-carousel-item ${index === activeAlertIndex ? 'active' : ''}`}
              >
                <div className={alertClass}>
                  <strong>{alert.type === 'traffic_change' ? '⚠️ ' : '📊 '}</strong>
                  {alert.message}
                </div>
              </div>
            );
          })}
        </div>
      </>
    );
  };

  const handleCommentSubmit = async (e) => {
    e.preventDefault();
    if (!comment.trim() || isCommentSubmitting) return;
    
    setIsCommentSubmitting(true);
    
    try {
      const response = await fetch(`${API_BASE_URL}/reply-comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: comment.trim() }),
      });
      
      const data = await response.json();
      
      if (data.status === 'success') {
        setComment('');
        setCommentResponses(prev => ({
          ...prev,
          [data.stream_id]: {
            text: '',
            comment: comment.trim(),
            complete: false,
            streamId: data.stream_id
          }
        }));
      }
    } catch (error) {
      console.error('Error submitting comment:', error);
    } finally {
      setIsCommentSubmitting(false);
    }
  };

  return (
    <div className="main-container container-fluid">
          
      <nav class="navbar">
          <div class="logo">LOUIS VUITTON</div>
      </nav>
      <div className="row g-0 h-100">
        {/* 左侧面板 - 数据统计 */}
        <div className="side-panel col-lg-4 p-3">
          <div className="stats-container h-100 bg-light rounded-3 p-3">
            <div className="question-container mb-4">
            <h4 className="stats-header">定式话术生成</h4>
            
            <form onSubmit={handleQuestionSubmit} className="question-form">
              <div className="input-group">
                <input
                  type="text"
                  className="form-control"
                  placeholder="请输入您的生成需求..."
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  disabled={isSubmitting}
                />
                <button 
                  type="submit" 
                  className="btn btn-primary" 
                  disabled={isSubmitting || !question.trim()}
                >
                  {isSubmitting ? '发送中...' : '发送'}
                </button>
              </div>
            </form>
            
            <div className="question-responses" ref={questionResponsesContainerRef}>
              {Object.values(questionResponses).map((response, index) => (
                <div key={response.streamId || index} className="response-item">
                  <div className="question-text">
                    <strong>需求:</strong> {response.question}
                  </div>
                  <div className="answer-text">
                    {response.error ? (
                      <div className="error-message">{response.errorMessage || '处理问题时出错'}</div>
                    ) : (
                      <>
                        <ReactMarkdown rehypePlugins={[rehypeRaw]}>
                          {response.text || ''}
                        </ReactMarkdown>
                        {!response.complete && <span className="typing-cursor">|</span>}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="comment-container mb-4">
            <h4 className="stats-header">重点评论智能回复</h4>
            <form onSubmit={handleCommentSubmit} className="comment-form">
              <div className="input-group">
                <input
                  type="text"
                  className="form-control"
                  placeholder="请输入需要回复的客户评论..."
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  disabled={isCommentSubmitting}
                />
                <button 
                  type="submit" 
                  className="btn btn-primary" 
                  disabled={isCommentSubmitting || !comment.trim()}
                >
                  {isCommentSubmitting ? '发送中...' : '发送'}
                </button>
              </div>
            </form>
            
            <div className="comment-responses" ref={commentResponsesContainerRef}>
              {Object.values(commentResponses).map((response, index) => (
                <div key={response.streamId || index} className="response-item">
                  <div className="comment-text">
                    <strong>评论:</strong> {response.comment}
                  </div>
                  <div className="reply-text">
                    {response.error ? (
                      <div className="error-message">{response.errorMessage || '处理评论时出错'}</div>
                    ) : (
                      <>
                        <ReactMarkdown rehypePlugins={[rehypeRaw]}>
                          {response.text || ''}
                        </ReactMarkdown>
                        {!response.complete && <span className="typing-cursor">|</span>}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="audience-analysis mb-4">
                      
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
                <span className="batch-status ms-3">
                  {isBatchRunning ? '（模拟运行中）' : '（模拟已停止）'}
                </span>
              </div>
              <div className="controls">
                <button 
                  className={`btn btn-sm ${isBatchRunning ? 'btn-secondary' : 'btn-success'} me-2`}
                  onClick={() => handleBatchControl('start')}
                  disabled={isBatchRunning}
                >
                  ▶ 启动模拟
                </button>
                <button 
                  className={`btn btn-sm ${!isBatchRunning ? 'btn-secondary' : 'btn-danger'}`}
                  onClick={() => handleBatchControl('stop')}
                  disabled={!isBatchRunning}
                >
                  ⏹ 停止模拟
                </button>
              </div>
            </div>
            
            {/* 更新告警容器 */}
            <div className="alerts-container position-relative mt-2" ref={alertsContainerRef}>
              {alerts.length > 0 && (
                <div className="alerts-counter">{alerts.length}</div>
              )}
              {renderAlerts()}
            </div>
          </div>

          {/* 视频容器 */}
          <div className="live-viewport-container flex-grow-1">
            <div className="live-viewport">
              <div className="player-wrapper">
                <ReactPlayer
                  url="http://localhost:8080/LV.mp4"
                  playing
                  controls
                  width="100%"
                  height="100%"
                  style={{ 
                    position: 'absolute', 
                    top: 0, 
                    left: 0, 
                    objectFit: 'cover'  // 确保视频覆盖整个容器
                  }}
                  config={{ 
                    file: { 
                      attributes: { 
                        controlsList: "nodownload",
                        style: { 
                          width: '100%', 
                          height: '100%', 
                          objectFit: 'cover'  // 确保视频覆盖整个容器
                        }
                      }
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
              <small className="form-text text-muted">不填写则使用默认模板(ID:43)</small>
            </div>
            
            <div className="script-recommendations mb-4">
              <h5>实时话术推荐</h5>
              {renderButtons()}
              <div className="recommendations-container" ref={recommendationsContainerRef}>
                {renderScriptRecommendations()}
              </div>
            </div>
            
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