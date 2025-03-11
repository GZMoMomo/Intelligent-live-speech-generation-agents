FROM python:3.9-slim
WORKDIR /app
COPY requirements.txt .
COPY app.py .
COPY Bailian_Data_Sample_LV_20241212.xlsx .  
RUN pip install --no-cache-dir -r requirements.txt
EXPOSE 5000
CMD ["python", "app.py"]