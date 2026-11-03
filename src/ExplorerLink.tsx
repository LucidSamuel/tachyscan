import type { ComponentChildren } from 'preact';

export function ExplorerLink({ href, onNavigate, children, class: className, title, 'aria-current': ariaCurrent }: {
  href: string;
  onNavigate: (path: string) => void;
  children: ComponentChildren;
  class?: string;
  title?: string;
  'aria-current'?: 'page';
}) {
  return (
    <a class={className} href={href} title={title} aria-current={ariaCurrent} onClick={(event) => {
      // Leave modified clicks to the browser so permalinks also work in new tabs.
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      onNavigate(href);
    }}>{children}</a>
  );
}
