import { useEffect, useReducer } from 'react';
import { reduce, type ViewAction, type ViewState } from './view';
import { loadViewState, saveViewState } from './persist';
export function useViewState(): [ViewState, (a: ViewAction) => void] {
  const [state, dispatch] = useReducer(reduce, undefined, loadViewState);
  useEffect(() => saveViewState(state), [state]);
  return [state, dispatch];
}
