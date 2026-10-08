"""验证注入器版本边界、备份识别和幂等重建，使用临时微型程序包。"""
import json
import contextlib
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import inject
from build import rewrite, sha


class Empty:
    tree = {'files': {}}
    def entries(self):
        return iter(())


class InjectionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.target = self.root / 'app.asar'
        rewrite(Empty(), self.target, {'package.json': b'{"version":"3.11.2"}'})
        self.spec = {'sha256': sha(self.target.read_bytes())}
        self.scopes = [patch.object(inject, 'OUT', self.root / 'out'),
                       patch.dict(inject.SUPPORTED, {'3.11.2': self.spec})]
        for scope in self.scopes:
            scope.start()
            self.addCleanup(scope.stop)

    def installed_archive(self, with_backup=True):
        folder=inject.OUT / '3.11.2' / self.spec['sha256']
        folder.mkdir(parents=True,exist_ok=True)
        if with_backup:(folder / 'app.original.asar').write_bytes(self.target.read_bytes())
        installed=self.root / 'installed.asar'
        metadata={'version':'3.11.2','sourceSha256':self.spec['sha256'],'revision':'a'*64,'source':'C:/not-trusted'}
        rewrite(Empty(),installed,{'package.json':b'{"version":"3.11.2"}',inject.META:json.dumps(metadata).encode()})
        (folder / ('app.wb-'+metadata['revision'][:12]+'.asar')).write_bytes(installed.read_bytes())
        return installed,folder / 'app.original.asar'

    def test_original_version(self):
        version, spec, source, current, metadata = inject.inspect_source(self.target)
        self.assertEqual(version, '3.11.2')
        self.assertEqual(source, self.target)
        self.assertIsNone(metadata)

    def test_unknown_version(self):
        other = self.root / 'unknown.asar'
        rewrite(Empty(), other, {'package.json': b'{"version":"99.0.0"}'})
        before = other.read_bytes()
        with self.assertRaisesRegex(RuntimeError, '尚未适配'):
            inject.inspect_source(other)
        self.assertEqual(before, other.read_bytes())

    def test_changed_original_rejected(self):
        self.spec['sha256'] = 'unexpected'
        with self.assertRaisesRegex(RuntimeError, '哈希不匹配'):
            inject.inspect_source(self.target)

    def test_installed_uses_verified_original(self):
        installed,backup=self.installed_archive()
        self.assertEqual(inject.inspect_source(installed)[2], backup)
        self.assertEqual(inject.inspect_source(installed)[2], backup)

    def test_missing_backup_rejected(self):
        installed,_=self.installed_archive(with_backup=False)
        with self.assertRaisesRegex(RuntimeError, '找不到本版本原包备份'):
            inject.inspect_source(installed)

    def test_unrecognized_patch_metadata_rejected(self):
        installed=self.root / 'unrecognized.asar'
        rewrite(Empty(),installed,{'package.json':b'{"version":"3.11.2"}',inject.META:b'{}'})
        with self.assertRaisesRegex(RuntimeError,'补丁元数据不匹配'):
            inject.inspect_source(installed)

    def test_other_changes_in_installed_patch_rejected(self):
        installed,_=self.installed_archive()
        with installed.open('ab') as stream:stream.write(b'unrelated change')
        before=installed.read_bytes()
        with self.assertRaisesRegex(RuntimeError,'拒绝覆盖其他修改'):
            inject.inspect_source(installed)
        self.assertEqual(installed.read_bytes(),before)


class LifecycleTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        self.target=self.root / 'custom install' / 'resources' / 'app.asar'
        self.target.parent.mkdir(parents=True)
        self.data=self.root / 'separate data'
        empty=Empty()
        empty.tree={'files':{'out':{'files':{'renderer':{'files':{'assets':{'files':{}}}}}}}}
        self.asset='out/renderer/assets/main.js'
        rewrite(empty,self.target,{'package.json':b'{"version":"3.14.4"}',self.asset:b'/* data-composer-leading-content */ __MOUNT__; __BADGE__;','keep.txt':b'unchanged'})
        self.original=self.target.read_bytes()
        self.spec={'sha256':sha(self.original),'asset':self.asset,'marker':'__MOUNT__','privacy_marker':'__BADGE__','props':'','api':''}
        for scope in [patch.object(inject,'OUT',self.data),patch.dict(inject.SUPPORTED,{'3.14.4':self.spec}),patch.object(inject,'check_closed')]:
            scope.start();self.addCleanup(scope.stop)

    def run_main(self,*actions):
        with patch('sys.argv',['inject.py','--target',str(self.target),'--data-dir',str(self.data),*actions]),contextlib.redirect_stdout(io.StringIO()):
            inject.main()

    def test_preview_keeps_installed_archive(self):
        self.run_main()
        self.assertEqual(self.target.read_bytes(),self.original)
        self.assertTrue((self.data/'3.14.4'/self.spec['sha256']/'app.original.asar').is_file())

    def test_apply_and_rerun_are_idempotent(self):
        self.run_main('--apply')
        first=self.target.read_bytes();modified=self.target.stat().st_mtime_ns
        self.assertNotEqual(first,self.original)
        self.run_main('--apply')
        self.assertEqual(self.target.read_bytes(),first)
        self.assertEqual(self.target.stat().st_mtime_ns,modified)

    def test_rollback_restores_exact_original(self):
        self.run_main('--apply');self.run_main('--rollback')
        self.assertEqual(self.target.read_bytes(),self.original)

    def test_running_app_blocks_replacement(self):
        with patch.object(inject,'check_closed',side_effect=RuntimeError('running')):
            with self.assertRaisesRegex(RuntimeError,'running'):self.run_main('--apply')
        self.assertEqual(self.target.read_bytes(),self.original)

    def test_package_changed_during_build_blocks_replacement(self):
        self.run_main()
        expected=sha(self.target.read_bytes())
        with self.target.open('ab') as stream:stream.write(b'updater changed package')
        before=self.target.read_bytes()
        with self.assertRaisesRegex(RuntimeError,'构建期间安装包发生变化'):
            inject.replace(self.target,self.target,expected)
        self.assertEqual(self.target.read_bytes(),before)

    def test_duplicate_mount_point_stops_build(self):
        self.spec['marker']='not-present'
        with self.assertRaisesRegex(RuntimeError,'挂载点不匹配'):self.run_main('--apply')
        self.assertEqual(self.target.read_bytes(),self.original)


if __name__ == '__main__':
    unittest.main()
