export type BibEntry = {
  id: string;
  type: string;
  title?: string;
  author?: string;
  year?: string;
};

export class BibliographyService {
  /**
   * Extremely simple parser for .bib content
   */
  static parse(content: string): BibEntry[] {
    const entries: BibEntry[] = [];
    if (!content) return entries;
    
    const bibRegex = /@([a-zA-Z]+)\s*\{\s*([^,]+),([^@]+)/g;
    let match;
    
    while ((match = bibRegex.exec(content)) !== null) {
      const type = match[1];
      const id = match[2].trim();
      const body = match[3];
      
      const titleMatch = body.match(/title\s*=\s*[\{"](.*?)[\\}"]/i);
      const authorMatch = body.match(/author\s*=\s*[\{"](.*?)[\\}"]/i);
      const yearMatch = body.match(/year\s*=\s*[\{"]?(\d+)[\}"]?/i);
      
      entries.push({
        id,
        type,
        title: titleMatch ? titleMatch[1] : undefined,
        author: authorMatch ? authorMatch[1] : undefined,
        year: yearMatch ? yearMatch[1] : undefined,
      });
    }
    
    return entries;
  }
  
  static extractCitations(texContent: string): string[] {
    const citations = new Set<string>();
    const citeRegex = /\\cite(?:[a-zA-Z]*)\{([^}]+)\}/g;
    let match;
    
    while ((match = citeRegex.exec(texContent)) !== null) {
      const keys = match[1].split(',').map(k => k.trim());
      for (const key of keys) {
        citations.add(key);
      }
    }
    
    return Array.from(citations);
  }

  static findUndefinedCitations(texContent: string, bibContent: string): string[] {
    const citations = this.extractCitations(texContent);
    const entries = this.parse(bibContent);
    const entryIds = new Set(entries.map(e => e.id));
    return citations.filter(c => !entryIds.has(c));
  }

  static findUnusedCitations(texContent: string, bibContent: string): string[] {
    const citations = new Set(this.extractCitations(texContent));
    const entries = this.parse(bibContent);
    return entries.filter(e => !citations.has(e.id)).map(e => e.id);
  }
}
