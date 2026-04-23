import mermaid from 'mermaid';

const code = `
graph TD
    subgraph PROC ["治理实施过程 Implementation Process (动态闭环)"]
        direction LR
        A --> B
    end
`;

async function test() {
  mermaid.initialize({ startOnLoad: false });
  try {
    const valid = await mermaid.parse(code);
    console.log("Quotes: Parsed successfully", valid);
  } catch (e) {
    console.error("Quotes: Parse failed", e);
  }
}

test();
