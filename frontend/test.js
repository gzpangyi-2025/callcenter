import React from 'react';
import { renderToString } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';

const md = `
# Title
Inline \`code\` here.

\`\`\`javascript
const x = 1;
\`\`\`

    indent block
`;

const Test = () => (
  <ReactMarkdown
    components={{
      code(props) {
        console.log('CODE PROPS:', Object.keys(props), props.className);
        return <code>{props.children}</code>;
      },
      pre(props) {
        console.log('PRE PROPS:', Object.keys(props));
        return <pre>{props.children}</pre>;
      }
    }}
  >
    {md}
  </ReactMarkdown>
);

console.log(renderToString(<Test />));
