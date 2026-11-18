#!/usr/bin/env ruby
# Fail-closed integration of the reviewed, customer-only Swift Keychain plugin
# into Capacitor's generated iOS Xcode project. Requires xcodeproj gem and macOS.
require 'fileutils'
require 'xcodeproj'

root = File.expand_path('..', __dir__)
project_path = File.join(root, 'apps/customer-web/ios/App/App.xcodeproj')
app_dir = File.join(root, 'apps/customer-web/ios/App/App')
sources = File.join(root, 'scripts/native/ios')
raise 'Missing isolated customer iOS project' unless File.file?(File.join(project_path, 'project.pbxproj'))
raise 'Missing isolated customer iOS app' unless File.directory?(app_dir)
project = Xcodeproj::Project.open(project_path)
target = project.targets.find { |item| item.name == 'App' && item.respond_to?(:source_build_phase) }
raise 'Missing expected App target' unless target
group = project.main_group.find_subpath('App', false)
raise 'Missing expected App source group' unless group && group.path == 'App'

%w[GastroFoodSecureSessionPlugin.swift GastroFoodViewController.swift].each do |name|
  source = File.join(sources, name)
  raise "Missing reviewed native source: #{name}" unless File.file?(source)
  dest = File.join(app_dir, name)
  FileUtils.cp(source, dest)
  reference = group.files.find { |file| file.path == name } || group.new_file(name)
  unless target.source_build_phase.files_references.include?(reference)
    target.source_build_phase.add_file_reference(reference)
  end
end

storyboard = File.join(app_dir, 'Base.lproj/Main.storyboard')
raise 'Missing expected Capacitor storyboard' unless File.file?(storyboard)
body = File.read(storyboard)
if body.include?('customClass="GastroFoodViewController"')
  raise 'Incorrect iOS storyboard module' unless body.include?('customModule="App"')
else
  original = /customClass="CAPBridgeViewController"(?: customModule="Capacitor")?/
  raise 'Unrecognized Capacitor storyboard controller; manual review required' unless body.match?(original)
  body = body.sub(original,'customClass="GastroFoodViewController" customModule="App"')
end
File.write(storyboard, body)
project.save
puts 'GastroFlow Food Keychain native sources registered in isolated iOS App target.'
