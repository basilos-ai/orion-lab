type MarkdownNode = { type: string; depth?: number; children?: MarkdownNode[] };
/** Message content is subordinate to the page title, even if a model starts at ###. */
export function remarkMessageHeadings() {
  return (tree: unknown) => {
    const headings: MarkdownNode[] = [];
    const visit = (node: MarkdownNode) => { if(node.type==='heading'&&typeof node.depth==='number')headings.push(node);node.children?.forEach(visit); };
    visit(tree as MarkdownNode);
    if(!headings.length)return;
    const base=Math.min(...headings.map(n=>n.depth!));let previous=1;
    for(const heading of headings){const requested=Math.min(6,2+heading.depth!-base);heading.depth=Math.min(requested,previous+1);previous=heading.depth;}
  };
}
