import type { Stage } from './stages';

export type Collection = {
  id: string;
  name: string;
  theme: string | null;
  notes: string | null;
  created_at: string;
};

export type Design = {
  id: string;
  collection_id: string | null;
  prompt_id: string | null;
  stage: Stage;
  title: string;
  tags: string[];
  source_model: string | null;
  source_params: unknown;
  seed: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  stage_changed_at: string;
};

export type StageEvent = {
  id: string;
  design_id: string;
  from_stage: Stage | null;
  to_stage: Stage;
  note: string | null;
  created_at: string;
};

/**
 * A design joined to its collection name and a thumbnail.
 *
 * The thumbnail is the design's primary artwork; `artwork_labels` says which placements it
 * actually has, so the board can show that a design is front-only at a glance.
 */
export type DesignCard = Design & {
  collection_name: string | null;
  image_url: string | null;
  artwork_labels: string[];
};
