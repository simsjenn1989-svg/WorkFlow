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
  /**
   * Generated images not yet picked from.
   *
   * The thumbnail used to come only from a chosen keeper, so a design with two finished
   * images and no decision made showed "No image yet" — which reads as a failed generation
   * when it is actually waiting on you. The count is here so the card can say which it is.
   */
  unchosen_variants: number;
  /** The most recent generation for this design, when there has been one. */
  job: {
    id: string;
    status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
    error: string | null;
    predictionId: string | null;
    createdAt: string;
    /** What it was asked for, so a failed one can be run again with the same settings. */
    retry: { prompt: string; model: string; count: number; label: string } | null;
  } | null;
};
