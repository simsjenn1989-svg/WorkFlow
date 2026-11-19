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
  raw_image_path: string | null;
  print_ready_path: string | null;
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

/** A design joined to its collection name and a displayable image URL. */
export type DesignCard = Design & {
  collection_name: string | null;
  image_url: string | null;
};
