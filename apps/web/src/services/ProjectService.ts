import { ProjectFile } from "./types";

export class ProjectService {
  /**
   * Transforms a flat list of files into a hierarchical tree.
   * Ensures no duplicate folders or files are created.
   */
  static buildTree(files: { id?: string; path: string; content?: string; type?: string }[]): ProjectFile[] {
    const root: ProjectFile[] = [];
    const map = new Map<string, ProjectFile>();
    
    const getOrCreateFolder = (path: string): ProjectFile => {
      let node = map.get(path);
      if (node) return node;
      
      const parts = path.split('/');
      const name = parts[parts.length - 1];
      
      node = {
        id: path,
        name,
        path,
        type: 'folder',
        children: []
      };
      
      map.set(path, node);
      
      if (parts.length > 1) {
        const parentPath = parts.slice(0, -1).join('/');
        const parent = getOrCreateFolder(parentPath);
        parent.children!.push(node);
      } else {
        root.push(node);
      }
      
      return node;
    };

    // First pass: identify all folders and files
    for (const f of files) {
      if (f.type === 'folder') {
        getOrCreateFolder(f.path);
        continue;
      }

      const parts = f.path.split('/');
      const name = parts[parts.length - 1];
      
      // Determine file type
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
        children: undefined
      };

      if (map.has(f.path)) continue; // avoid duplicates
      map.set(f.path, node);

      if (parts.length > 1) {
        const parentPath = parts.slice(0, -1).join('/');
        const parent = getOrCreateFolder(parentPath);
        parent.children!.push(node);
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
