export type OutlineNode = {
  id: string;
  title: string;
  level: number;
  line: number;
  children: OutlineNode[];
};

export class OutlineService {
  /**
   * Parses LaTeX content and returns a hierarchical outline.
   */
  static parse(content: string): OutlineNode[] {
    if (!content) return [];
    
    const lines = content.split('\n');
    const nodes: OutlineNode[] = [];
    const stack: { node: OutlineNode; level: number }[] = [];
    
    const headingRegex = /\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\{([^}]+)\}/;
    
    const levelMap: Record<string, number> = {
      'part': 0,
      'chapter': 1,
      'section': 2,
      'subsection': 3,
      'subsubsection': 4,
      'paragraph': 5,
      'subparagraph': 6
    };

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(headingRegex);
      if (match) {
        const type = match[1];
        const title = match[2];
        const level = levelMap[type] ?? 2;
        
        const node: OutlineNode = {
          id: `heading-${i}`,
          title,
          level,
          line: i + 1,
          children: []
        };
        
        while (stack.length > 0 && stack[stack.length - 1].level >= level) {
          stack.pop();
        }
        
        if (stack.length === 0) {
          nodes.push(node);
        } else {
          stack[stack.length - 1].node.children.push(node);
        }
        
        stack.push({ node, level });
      }
    }
    
    return nodes;
  }
}
