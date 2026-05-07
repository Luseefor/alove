import { ProjectFile } from "./types";

export class ProjectService {
  /**
   * Transforms a flat list of files (from DB or local memory) into a hierarchical tree.
   */
  static buildTree(files: { id?: string; path: string; content?: string; type?: string }[]): ProjectFile[] {
    const root: ProjectFile[] = [];
    const map = new Map<string, ProjectFile>();
    
    for (const f of files) {
      const parts = f.path.split('/');
      const name = parts[parts.length - 1];
      let type = f.type as ProjectFile["type"] | undefined;
      if (!type) {
         if (name.endsWith('.tex')) type = 'tex';
         else if (name.endsWith('.bib')) type = 'bib';
         else if (name.endsWith('.sty')) type = 'sty';
         else if (name.endsWith('.pdf')) type = 'pdf';
         else if (/\.(png|jpe?g|gif|webp|bmp|ico)$/i.test(name)) type = 'image';
         else type = 'markdown';
      }
      
      const node: ProjectFile = {
        id: f.id || f.path,
        name,
        path: f.path,
        type,
        content: f.content,
        children: type === 'folder' ? [] : undefined
      };
      
      map.set(f.path, node);
    }
    
    for (const [path, node] of map.entries()) {
      const parts = path.split('/');
      if (parts.length > 1) {
        const parentPath = parts.slice(0, -1).join('/');
        let parent = map.get(parentPath);
        if (!parent) {
          parent = {
             id: parentPath,
             name: parts[parts.length - 2] || parentPath,
             path: parentPath,
             type: 'folder',
             children: []
          };
          map.set(parentPath, parent);
          if (parts.length === 2) root.push(parent); // only push top-level virtual folders to root
        }
        parent.children = parent.children || [];
        parent.children.push(node);
      } else {
        root.push(node);
      }
    }
    
    const sortTree = (nodes: ProjectFile[]) => {
      nodes.sort((a, b) => {
        if (a.type === 'folder' && b.type !== 'folder') return -1;
        if (a.type !== 'folder' && b.type === 'folder') return 1;
        return a.name.localeCompare(b.name);
      });
      nodes.forEach(n => {
        if (n.children) sortTree(n.children);
      });
    };
    
    sortTree(root);
    return root;
  }
}
