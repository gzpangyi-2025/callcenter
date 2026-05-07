import re

with open('frontend/src/pages/Admin/components/CodexConfigTab.tsx', 'r') as f:
    content = f.read()

# Add Radio to antd imports
content = content.replace("import { Card, Form, Input, InputNumber, Button, Switch, message, Spin, Alert, Badge, Descriptions, Space } from 'antd';",
"import { Card, Form, Input, InputNumber, Button, Switch, message, Spin, Alert, Badge, Descriptions, Space, Radio } from 'antd';")

# Add CloudServerOutlined to icons
content = content.replace("import { SaveOutlined, WarningOutlined, ThunderboltOutlined, CheckCircleOutlined } from '@ant-design/icons';",
"import { SaveOutlined, WarningOutlined, ThunderboltOutlined, CheckCircleOutlined, CloudServerOutlined } from '@ant-design/icons';")

# Fix missing `provider` state
# The previous script might not have added setProvider correctly, let's check
if "const [provider, setProvider]" not in content:
    content = content.replace("const [workerConfig, setWorkerConfig] = useState<any>(null);", 
"""const [workerConfig, setWorkerConfig] = useState<any>(null);
  const [provider, setProvider] = useState<'tencent' | 's3'>('tencent');""")

with open('frontend/src/pages/Admin/components/CodexConfigTab.tsx', 'w') as f:
    f.write(content)

