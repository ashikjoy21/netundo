import { ChevronRight } from 'lucide-react';

export interface Crumb {
  label: string;
  href?: string;
}

export function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm text-gray-500">
      {crumbs.map((crumb, i) => (
        <span key={crumb.label} className="flex items-center gap-1">
          {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-gray-300" />}
          {crumb.href ? (
            <a href={crumb.href} className="transition-colors hover:text-cf-orange">
              {crumb.label}
            </a>
          ) : (
            <span className="font-medium text-gray-700">{crumb.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
