# 使用Node.js镜像
FROM node:14

# 安装http-server
RUN npm install -g http-server

# 设置工作目录
WORKDIR /app
COPY public/ ./public

# 暴露端口
EXPOSE 8080

# 启动命令
CMD ["http-server", "public", "-p", "8080"]