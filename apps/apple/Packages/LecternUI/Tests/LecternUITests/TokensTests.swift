import SwiftUI
import XCTest
@testable import LecternUI

final class TokensTests: XCTestCase {
    /// <repo>/apps/apple/Packages/LecternUI/Tests/LecternUITests/TokensTests.swift → <repo>
    private var repoRoot: URL {
        var url = URL(fileURLWithPath: #filePath)
        for _ in 0..<7 { url.deleteLastPathComponent() }
        return url
    }

    func testTokensFileMatchesSource() throws {
        let source = repoRoot.appendingPathComponent("packages/design-tokens/dist/Tokens.swift")
        let copy = repoRoot.appendingPathComponent("apps/apple/Packages/LecternUI/Sources/LecternUI/Tokens/Tokens.swift")
        XCTAssertEqual(try Data(contentsOf: copy), try Data(contentsOf: source), "run: cp packages/design-tokens/dist/Tokens.swift apps/apple/Packages/LecternUI/Sources/LecternUI/Tokens/")
    }

    private func rgb(_ color: Color, _ scheme: ColorScheme) -> (r: Int, g: Int, b: Int, a: Double) {
        var environment = EnvironmentValues()
        environment.colorScheme = scheme
        let resolved = color.resolve(in: environment)
        let srgb = resolved.cgColor.converted(to: CGColorSpace(name: CGColorSpace.sRGB)!, intent: .defaultIntent, options: nil)!
        let c = srgb.components!
        return (Int((c[0] * 255).rounded()), Int((c[1] * 255).rounded()), Int((c[2] * 255).rounded()), Double(c[3]))
    }

    func testThemeColorsExistForBothSchemes() {
        for (name, color) in Theme.all {
            for scheme in [ColorScheme.light, .dark] {
                let value = rgb(color, scheme)
                XCTAssertTrue((0...255).contains(value.r) && (0...255).contains(value.g) && (0...255).contains(value.b), "\(name) \(scheme)")
                XCTAssertGreaterThan(value.a, 0, "\(name) \(scheme)")
            }
        }
        // The generated pair for one token, exactly: 0x1A1B1E light, 0xF7F8F8 dark.
        let light = rgb(Theme.textPrimary, .light)
        let dark = rgb(Theme.textPrimary, .dark)
        XCTAssertEqual([light.r, light.g, light.b], [0x1A, 0x1B, 0x1E])
        XCTAssertEqual([dark.r, dark.g, dark.b], [0xF7, 0xF8, 0xF8])
    }
}
