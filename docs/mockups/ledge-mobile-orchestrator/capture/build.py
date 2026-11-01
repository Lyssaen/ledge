# Rebuilds index.html from source.html: each {{IMG:name}} becomes shots/<name>.png as a data URI.
# Run from docs/mockups/ledge-mobile-orchestrator: python3 capture/build.py
import base64, re
s = open('source.html').read()
s = re.sub(r'\{\{IMG:([\w-]+)\}\}', lambda m: 'data:image/png;base64,' + base64.b64encode(open(f'shots/{m.group(1)}.png', 'rb').read()).decode(), s)
open('index.html', 'w').write(s)
