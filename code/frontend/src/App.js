import React, { useState, useEffect, useRef } from 'react';
import 'bootstrap/dist/css/bootstrap.min.css';
import ReactPlayer from 'react-player';
import './LiveStreamPage.css';

const MAX_MESSAGES = 8; // 最多显示8条消息

const LiveStreamPage = () => {
  const [messages, setMessages] = useState([]);
  const messagesContainerRef = useRef(null);
  const eventSourceRef = useRef(null);

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

    // 建立SSE连接
    eventSourceRef.current = new EventSource('http://localhost:5000/api/stream');
    
    eventSourceRef.current.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const { live_interaction, user_profile } = data;
        
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
              type: live_interaction.interaction
            }];
            return newMessages.slice(-MAX_MESSAGES);
          });
        }
      } catch (error) {
        console.error('Error parsing SSE data:', error);
      }
    };

    return () => {
      eventSourceRef.current?.close();
      
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

  return (
    <div className="main-container container-fluid">
      <div className="row g-0 h-100">
        {/* 左侧面板 */}
        <div className="side-panel col-lg-4 p-3">
          <div className="stats-container h-100 bg-light rounded-3 p-3">
            <div className="placeholder-text">左侧数据统计区域</div>
          </div>
        </div>

        {/* 直播核心区域 */}
        <div className="col-lg-4 d-flex flex-column">
          {/* 顶部统计 */}
          <div className="top-stats bg-light rounded-3 mb-3 p-3">
            <div className="placeholder-text">顶部实时数据</div>
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
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 底部统计 */}
          <div className="bottom-stats bg-light rounded-3 mt-3 p-3">
            <div className="placeholder-text">底部统计信息</div>
          </div>
        </div>

        {/* 右侧面板 */}
        <div className="side-panel col-lg-4 p-3">
          <div className="stats-container h-100 bg-light rounded-3 p-3">
            <div className="placeholder-text">右侧话术建议</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LiveStreamPage;