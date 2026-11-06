import XCTest
@testable import XSSH

final class RandomArtTests: XCTestCase {
    func testKnownFingerprintDrawsTheExpectedImage() throws {
        let art = try XCTUnwrap(RandomArt.lines(fingerprint: "SHA256:S5eJEYbJ+XGdEbJIvbZgu0If7rMOhxgx/XmE+bYKScw"))
        XCTAssertEqual(art, [
            "     . ++...o+   ",
            "     .=o.=ooo    ",
            "    o ..=oo.     ",
            "     = .+*oo     ",
            "    . E.S+B.     ",
            "     +.+o=..     ",
            "    ..=ooo.      ",
            "      .+=.       ",
            "       +=o       ",
        ])
    }

    func testSameKeySameImageAndShape() throws {
        let a = try XCTUnwrap(RandomArt.lines(fingerprint: "SHA256:S5eJEYbJ+XGdEbJIvbZgu0If7rMOhxgx/XmE+bYKScw"))
        XCTAssertEqual(a.count, RandomArt.height)
        XCTAssertTrue(a.allSatisfy { $0.count == RandomArt.width })
    }

    func testUnknownFormatsHaveNoImage() {
        XCTAssertNil(RandomArt.lines(fingerprint: "MD5:aa:bb:cc"))
        XCTAssertNil(RandomArt.lines(fingerprint: "SHA256:!!!not base64!!!"))
        XCTAssertNil(RandomArt.lines(fingerprint: ""))
    }

    func testFingerprintIsWrappedIntoShortLines() {
        let lines = RandomArt.wrapped("SHA256:S5eJEYbJ+XGdEbJIvbZgu0If7rMOhxgx/XmE+bYKScw")
        XCTAssertEqual(lines, ["S5eJEYbJ+XGd", "EbJIvbZgu0If", "7rMOhxgx/XmE", "+bYKScw"])
    }
}
