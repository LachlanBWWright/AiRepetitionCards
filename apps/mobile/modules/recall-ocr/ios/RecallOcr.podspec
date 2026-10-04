Pod::Spec.new do |s|
  s.name = 'RecallOcr'
  s.version = '0.1.0'
  s.summary = 'Offline study material text recognition'
  s.description = s.summary
  s.license = 'MIT'
  s.author = 'Recall'
  s.homepage = 'https://docs.expo.dev/modules/'
  s.source = { :git => 'https://github.com/expo/expo.git' }
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'Vision', 'PDFKit', 'ImageIO', 'UIKit'
  s.source_files = '**/*.{h,m,swift}'
end
