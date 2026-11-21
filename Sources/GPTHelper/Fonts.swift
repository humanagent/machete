import AppKit
import CoreText
import SwiftUI

/// Inter (OFL, bundled as Resources/InterVariable.ttf) for the whole UI; falls back to the system font.
enum AppFonts {
    static func register() {
        guard let url = Bundle.main.url(forResource: "InterVariable", withExtension: "ttf") else {
            Log.write("font: InterVariable.ttf not bundled, using system font"); return
        }
        var err: Unmanaged<CFError>?
        if !CTFontManagerRegisterFontsForURL(url as CFURL, .process, &err) {
            Log.write("font: register failed \(err?.takeRetainedValue().localizedDescription ?? "")")
        }
    }
    static var interAvailable: Bool { NSFont(name: "Inter", size: 12) != nil }
}

extension Font {
    static func inter(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        AppFonts.interAvailable ? .custom("Inter", size: size).weight(weight) : .system(size: size, weight: weight)
    }
}
