declare module "nspell" {
  export type NSpellInstance = {
    correct(word: string): boolean;
    suggest(word: string): string[];
    add(word: string): void;
    remove(word: string): void;
    dictionary(dic: string | Uint8Array): void;
  };
  function NSpell(
    aff: string | Uint8Array,
    dic?: string | Uint8Array,
  ): NSpellInstance;
  export default NSpell;
}
