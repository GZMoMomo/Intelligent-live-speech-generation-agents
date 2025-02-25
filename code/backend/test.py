import json

# 测试数据
data = {
    'name': 'John "Smith"'
}

print("\n方法3:")
print(json.dumps(data).replace('"', '\"'))