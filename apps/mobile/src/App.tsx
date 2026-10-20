import { useRoute } from './router';

/** One empty screen per route; the screens arrive with the next tasks. */
export function App() {
  const route = useRoute();
  return <main className="app" data-route={route.name} />;
}
