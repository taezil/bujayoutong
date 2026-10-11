declare module "*.svg?react" {
  import type { FunctionComponent, SVGProps } from "react";
  const Component: FunctionComponent<SVGProps<SVGSVGElement>>;
  export default Component;
}


declare module "*.sql?raw" {
  const content: string;
  export default content;
}
