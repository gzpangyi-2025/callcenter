import re

with open('frontend/src/pages/Admin/components/CodexConfigTab.tsx', 'r') as f:
    content = f.read()

content = content.replace("        </Card>\n        </>)}", "        </Card>")

with open('frontend/src/pages/Admin/components/CodexConfigTab.tsx', 'w') as f:
    f.write(content)
