"""ASAR read/write helpers using only the Python standard library."""
import hashlib
import json
import struct


def sha(data):
    return hashlib.sha256(data).hexdigest()


class Archive:
    def __init__(self, path):
        self.path = path
        with path.open('rb') as f:
            header = struct.unpack('<4I', f.read(16))
            self.base = 8 + header[1]
            self.tree = json.loads(f.read(header[3]))

    def entries(self, node=None, prefix=''):
        for name, meta in (node or self.tree)['files'].items():
            path = prefix + name
            if 'files' in meta:
                yield from self.entries(meta, path + '/')
            else:
                yield path, meta

    def read(self, path):
        meta = self.tree
        for component in path.split('/'):
            meta = meta['files'][component]
        if meta.get('unpacked') or 'link' in meta:
            raise ValueError(f'不支持直接读取外置或链接条目：{path}')
        with self.path.open('rb') as f:
            f.seek(self.base + int(meta['offset']))
            return f.read(meta['size'])


def set_entry(tree, path, value):
    node = tree
    parts = path.split('/')
    for part in parts[:-1]:
        node = node['files'][part]
    node['files'][parts[-1]] = value


def rewrite(archive, destination, replacements):
    tree = json.loads(json.dumps(archive.tree))
    data_items = []
    offset = 0
    entries = dict(archive.entries())
    for name in replacements:
        if name not in entries:
            entries[name] = {}
    for name, old in entries.items():
        if old.get('unpacked') or 'link' in old:
            continue
        data = replacements[name] if name in replacements else archive.read(name)
        meta = dict(old)
        meta.update(size=len(data), offset=str(offset))
        if name in replacements or 'integrity' in meta:
            block = old.get('integrity', {}).get('blockSize', 4194304)
            meta['integrity'] = {'algorithm':'SHA256','hash':sha(data),'blockSize':block,
                                 'blocks':[sha(data[i:i+block]) for i in range(0,len(data),block)]}
        set_entry(tree, name, meta)
        offset += len(data)
        data_items.append(data)
    header = json.dumps(tree, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    payload_len = 4 + len(header)
    padded_len = (payload_len + 3) // 4 * 4
    pickle = struct.pack('<II', padded_len, len(header)) + header + bytes(padded_len-payload_len)
    with destination.open('xb') as f:
        f.write(struct.pack('<II', 4, len(pickle)))
        f.write(pickle)
        for data in data_items:
            f.write(data)

