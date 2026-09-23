// js-yaml has no bundled types and we don't want a new dependency just for
// them (ponytail); we only use `load`, so declare that much.
declare module "js-yaml" {
  export function load(input: string): unknown;
}
