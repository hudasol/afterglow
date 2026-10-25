import type { HardConstraint } from './intent.js';

/*
 * Plain functions over hard constraints. They live apart from the schemas so the browser can
 * use them without loading the validation library.
 */

export function constraintKey(constraint: HardConstraint): string {
  switch (constraint.kind) {
    case 'max_price_level':
      return 'max_price_level';
    case 'max_distance_km':
      return 'max_distance_km';
    case 'dietary':
      return `dietary:${constraint.requirement}`;
    case 'step_free_access':
    case 'open_at_plan_time':
    case 'fits_party_size':
    case 'covered_space':
      return constraint.kind;
  }
}

export function describeConstraint(constraint: HardConstraint): string {
  switch (constraint.kind) {
    case 'max_price_level':
      return `Price level no higher than ${constraint.level} of 4`;
    case 'max_distance_km':
      return `Within ${constraint.km} km of the original venue`;
    case 'dietary':
      return `Supports a ${constraint.requirement.replace('_', ' ')} diet`;
    case 'step_free_access':
      return 'Step free access';
    case 'open_at_plan_time':
      return 'Open for the whole plan window';
    case 'fits_party_size':
      return 'Can seat the whole party';
    case 'covered_space':
      return 'Covered or indoor space';
  }
}
