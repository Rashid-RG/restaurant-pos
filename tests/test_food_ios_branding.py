"""Local-only deterministic tests for the approved native iOS art generator."""
from __future__ import annotations
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from PIL import Image

SCRIPT=Path(__file__).resolve().parents[1]/'scripts'/'generate-food-ios-branding.py'
SPEC=importlib.util.spec_from_file_location('gastrofood_ios_branding',SCRIPT)
module=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)

class IosBrandingTests(unittest.TestCase):
    def make_fixture(self,root:Path):
        public=root/'public'
        public.mkdir()
        Image.new('RGBA',(512,512),(9,170,120,255)).save(public/'food-logo.png')
        assets=root/'ios'/'App'/'App'/'Assets.xcassets'
        icon=assets/'AppIcon.appiconset'
        splash=assets/'Splash.imageset'
        icon.mkdir(parents=True)
        splash.mkdir()
        (icon/'Contents.json').write_text(json.dumps({'images':[{'filename':'AppIcon-512@2x.png','idiom':'universal','platform':'ios','size':'1024x1024'}],'info':{'version':1,'author':'xcode'}}))
        (splash/'Contents.json').write_text(json.dumps({'images':[{'filename':'Default@1x~universal~anyany.png','idiom':'universal'}],'info':{'version':1,'author':'xcode'}}))
        Image.new('RGBA',(1024,1024)).save(icon/'AppIcon-512@2x.png')
        Image.new('RGBA',(320,480)).save(splash/'Default@1x~universal~anyany.png')
        return icon,splash

    def test_icon_splash_and_catalog_preservation(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            icon,splash=self.make_fixture(root)
            icon_json=(icon/'Contents.json').read_bytes()
            splash_json=(splash/'Contents.json').read_bytes()
            paths=module.generate_assets(root,enforce_root=False)
            self.assertEqual(len(paths),2)
            with Image.open(icon/'AppIcon-512@2x.png') as im:
                self.assertEqual((im.size,im.mode),((1024,1024),'RGB'))
                self.assertNotEqual(im.getpixel((512,512)),(247,247,242))
            with Image.open(splash/'Default@1x~universal~anyany.png') as im:
                self.assertEqual((im.size,im.mode),((320,480),'RGB'))
            self.assertEqual((icon/'Contents.json').read_bytes(),icon_json)
            self.assertEqual((splash/'Contents.json').read_bytes(),splash_json)

    def test_missing_generated_iOS_project_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(FileNotFoundError):
                module.generate_assets(Path(directory),enforce_root=False)

    def test_unapproved_root_is_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                module.generate_assets(Path(directory))

    def test_path_traversal_in_catalog_is_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            icon,_=self.make_fixture(root)
            entry=json.loads((icon/'Contents.json').read_text())
            entry['images'].append({'filename':'../../POS.png'})
            (icon/'Contents.json').write_text(json.dumps(entry))
            with self.assertRaises(ValueError):
                module.generate_assets(root,enforce_root=False)

if __name__=='__main__':
    unittest.main()
