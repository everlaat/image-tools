import { TOOLS, type ToolId } from './tools.ts';
import { useState } from 'react';

export function App() {
  const [active, setActive] = useState<ToolId>('background-removal');
  const activeTool = TOOLS.find((t) => t.id === active) ?? TOOLS[0];

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-border-subtle px-4 py-3">
        <div className="mx-auto flex max-w-6xl items-center gap-4">
          <h1 className="text-base font-semibold tracking-tight">Image Tools</h1>
          <p className="hidden text-sm text-ink-muted sm:block">
            Runs entirely on your device — no uploads.
          </p>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 p-4">
        <nav aria-label="Tools">
          <ul className="flex flex-wrap gap-2">
            {TOOLS.map((tool) => {
              const selected = tool.id === activeTool.id;
              return (
                <li key={tool.id}>
                  <button
                    type="button"
                    aria-current={selected ? 'page' : undefined}
                    disabled={!tool.available}
                    onClick={() => {
                      setActive(tool.id);
                    }}
                    className="rounded-md border border-border-subtle px-3 py-1.5 text-sm transition-colors enabled:hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-40 aria-[current=page]:border-accent aria-[current=page]:bg-surface-raised"
                  >
                    {tool.label}
                    {!tool.available && (
                      <span className="ml-1.5 text-xs text-ink-muted">soon</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <main className="flex-1">
          <h2 className="sr-only">{activeTool.label}</h2>
          <p className="text-sm text-ink-muted">{activeTool.description}</p>
        </main>
      </div>
    </div>
  );
}
