import { useState } from 'react';
import { BackgroundRemoval } from '../features/background-removal/BackgroundRemoval.tsx';
import { ModelCacheSettings } from '../components/ModelCacheSettings.tsx';
import { TOOLS, type ToolId } from './tools.ts';

export function App() {
  const [active, setActive] = useState<ToolId>('background-removal');
  const activeTool = TOOLS.find((tool) => tool.id === active) ?? TOOLS[0];

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-border-subtle px-4 py-3">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="text-base font-semibold tracking-tight">Image Tools</h1>
          <p className="text-sm text-ink-muted">
            Runs entirely on your device — no uploads.
          </p>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-5 p-4">
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
          {activeTool.id === 'background-removal' ? (
            <BackgroundRemoval />
          ) : (
            <p className="text-sm text-ink-muted">{activeTool.description}</p>
          )}
        </main>

        <footer className="border-t border-border-subtle pt-3">
          <ModelCacheSettings />
        </footer>
      </div>
    </div>
  );
}
