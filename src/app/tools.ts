export type ToolId = 'background-removal' | 'vectorize' | 'layers';

export interface ToolDescriptor {
  readonly id: ToolId;
  readonly label: string;
  readonly description: string;
  /** Phases ship one at a time; unavailable tools render as disabled. */
  readonly available: boolean;
}

export const TOOLS: readonly [ToolDescriptor, ...ToolDescriptor[]] = [
  {
    id: 'background-removal',
    label: 'Remove background',
    description: 'Cut the subject out of a photo and download it as a transparent PNG.',
    available: true,
  },
  {
    id: 'vectorize',
    label: 'Logo to SVG',
    description: 'Trace a raster logo into clean, scalable vector paths.',
    available: false,
  },
  {
    id: 'layers',
    label: 'Split layers',
    description: 'Separate an image into foreground, midground and background layers.',
    available: false,
  },
];
