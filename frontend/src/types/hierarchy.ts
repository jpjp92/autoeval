export interface HierarchyTree {
  h1_list: string[];
  h2_by_h1: Record<string, string[]>;
  h3_by_h1_h2: Record<string, string[]>;
}
