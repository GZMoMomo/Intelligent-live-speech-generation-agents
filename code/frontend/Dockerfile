# 使用Node.js镜像
FROM node:14

# 设置工作目录
WORKDIR /app

# 复制项目文件
COPY package*.json ./
COPY public/ ./public
COPY src/ ./src

# 安装依赖
RUN npm install

# 暴露端口
EXPOSE 3000

# 启动命令
CMD ["npm", "start"]