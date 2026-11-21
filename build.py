import json
w = open('src/worker.js', encoding='utf-8').read()
w = w.replace('"__INDEX_HTML__"', json.dumps(open('public/index.html', encoding='utf-8').read(), ensure_ascii=False))
w = w.replace('"__ADMIN_HTML__"', json.dumps(open('public/admin.html', encoding='utf-8').read(), ensure_ascii=False))
import os; os.makedirs('dist', exist_ok=True)
open('dist/worker.js', 'w', encoding='utf-8').write(w)
print('built dist/worker.js', len(w))
