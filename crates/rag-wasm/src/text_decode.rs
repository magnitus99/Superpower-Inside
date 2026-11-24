//! 평문 바이트의 단일 엄격 디코딩·probe 계약.

use chardetng::EncodingDetector;
use encoding_rs::{Encoding, GB18030, GBK, ISO_2022_JP, UTF_8, UTF_16BE, UTF_16LE};
use serde_json::json;
use std::borrow::Cow;
use wasm_bindgen::prelude::wasm_bindgen;

/// 호스트 전체 읽기·WASM 복사·최대 네 배 UTF-8 출력의 동시 생존 예산.
pub const SOURCE_BYTE_BUDGET: u64 = 64 * 1024 * 1024;
/// 언어 감지 표본은 제한하되 선택한 코덱은 전체 바이트를 엄격 검증한다.
const DETECTION_BYTES: usize = 64 * 1024;

/// 바이트를 검증하며 probe에서는 본문을 wire에 복제하지 않는다.
/// 빈 바이트와 실제 크기를 넘기면 호스트 I/O 전에 메모리 예산을 확인할 수 있다.
#[wasm_bindgen]
#[must_use]
pub fn decode_source_bytes_json(bytes: &[u8], include_text: bool, source_size: f64) -> String {
    if !source_size.is_finite()
        || !(0.0..=67_108_864.0).contains(&source_size)
        || source_size.fract() != 0.0
        || u64::try_from(bytes.len()).is_ok_and(|size| size > SOURCE_BYTE_BUDGET)
    {
        return failure("memory-budget");
    }
    match decode(bytes) {
        Ok((text, encoding, basis, selection_reason)) => json!({
            "ok":true, "text":if include_text { text.as_ref() } else { "" },
            "encoding":encoding, "reason":null, "basis":basis, "selectionReason":selection_reason,
        })
        .to_string(),
        Err(reason) => failure(reason),
    }
}

/// 실패를 빈 성공과 구분하는 wire.
fn failure(reason: &str) -> String {
    json!({"ok":false,"text":"","encoding":null,"reason":reason,"basis":null,"selectionReason":null}).to_string()
}

/// 공용 준비 경계는 JSON 본문 왕복 없이 같은 엄격 코덱과 평문 예산을 사용합니다.
pub fn decode_for_preparation(bytes: &[u8]) -> Result<String, &'static str> {
    if u64::try_from(bytes.len()).map_or(true, |size| size > SOURCE_BYTE_BUDGET) {
        return Err("memory-budget");
    }
    decode(bytes).map(|(text, _, _, _)| text.into_owned())
}

/// 복원 텍스트·코덱·판정 경계·선택 근거이며 통계 신뢰도 값은 만들지 않는다.
type DecodedText<'a> = (Cow<'a, str>, &'static str, &'static str, &'static str);

/// 확정 BOM·엄격 Unicode와 추정 legacy를 구분한다. 추정은 코덱의 유일성을 보증하지 않는다.
fn decode(bytes: &[u8]) -> Result<DecodedText<'_>, &'static str> {
    if has_binary_magic(bytes) {
        return Err("binary");
    }
    let (basis, selection_reason) =
        if Encoding::for_bom(bytes).is_some() || bytes.starts_with(&[0, 0, 0xfe, 0xff]) {
            ("bom", "byte-order-mark")
        } else if unicode_lane(bytes).is_some() {
            ("strict-unicode", "zero-lane")
        } else if has_iso2022_escape(bytes) {
            ("legacy-estimate", "iso-2022-jp-escape")
        } else if std::str::from_utf8(bytes).is_ok() {
            ("strict-unicode", "utf8")
        } else {
            ("legacy-estimate", "chardetng")
        };
    let (text, encoding) = if let Some(rest) = bytes.strip_prefix(&[0xff, 0xfe, 0, 0]) {
        (Cow::Owned(decode_utf32(rest, true)?), "UTF-32LE")
    } else if let Some(rest) = bytes.strip_prefix(&[0, 0, 0xfe, 0xff]) {
        (Cow::Owned(decode_utf32(rest, false)?), "UTF-32BE")
    } else if let Some((encoding, length)) = Encoding::for_bom(bytes) {
        (
            strict_decode(encoding, bytes.get(length..).ok_or("corrupt")?)?,
            encoding.name(),
        )
    } else if let Some(width) = unicode_lane(bytes) {
        match width {
            4 => (Cow::Owned(decode_utf32(bytes, true)?), "UTF-32LE"),
            -4 => (Cow::Owned(decode_utf32(bytes, false)?), "UTF-32BE"),
            2 => (strict_decode(UTF_16LE, bytes)?, "UTF-16LE"),
            _ => (strict_decode(UTF_16BE, bytes)?, "UTF-16BE"),
        }
    } else if has_iso2022_escape(bytes) {
        (strict_decode(ISO_2022_JP, bytes)?, ISO_2022_JP.name())
    } else if let Ok(text) = std::str::from_utf8(bytes) {
        (Cow::Borrowed(text), "UTF-8")
    } else {
        // 소량·단일 비ASCII 반복에는 추정 근거가 없다. UTF-8 유효 접두사만으로 손상을 확정하지 않는다.
        // 유효 UTF-8 접두사만으로 legacy 표본 수를 채우면 뒤의 손상을 재해석하게 된다.
        let error = std::str::from_utf8(bytes).err().ok_or("corrupt")?;
        let evidence = if bytes
            .get(..error.valid_up_to())
            .is_some_and(|prefix| !prefix.is_ascii())
        {
            bytes.get(error.valid_up_to()..).ok_or("corrupt")?
        } else {
            bytes
        };
        let high_bytes: Vec<u8> = evidence
            .iter()
            .copied()
            .filter(|byte| *byte >= 0x80)
            .collect();
        if high_bytes.len() < 6
            || high_bytes
                .iter()
                .all(|byte| Some(byte) == high_bytes.first())
            || repeated_non_ascii(bytes, &high_bytes)
        {
            return Err("ambiguous-encoding");
        }
        let mut detector = EncodingDetector::new();
        let start = bytes.iter().position(|byte| *byte >= 0x80).unwrap_or(0);
        let tail = bytes.get(start..).ok_or("corrupt")?;
        let sample = tail.get(..DETECTION_BYTES).unwrap_or(tail);
        detector.feed(sample, false);
        let unfinished = detector.guess(None, true);
        if sample.len() == tail.len() {
            detector.feed(&[], true);
        }
        // guess_assess의 bool은 다른 후보 하나보다 점수가 높은지만 뜻하며 확률·신뢰도가 아니다.
        let guessed = detector.guess(None, true);
        // 끝의 불완전한 단위 때문에 다른 코덱으로 바뀌면 대체 성공으로 숨기지 않는다.
        if guessed != unfinished {
            return Err("ambiguous-encoding");
        }
        if guessed == UTF_8 {
            return Err("ambiguous-encoding");
        }
        // WHATWG GBK의 상위 집합으로 네 바이트 문자도 엄격히 복원한다.
        let encoding = if guessed == GBK { GB18030 } else { guessed };
        (strict_decode(encoding, bytes)?, encoding.name())
    };
    if !valid_text(&text) {
        return Err("invalid-text");
    }
    Ok((text, encoding, basis, selection_reason))
}

/// 문맥 없이 짧은 비ASCII 패턴만 반복하는 입력은 통계 추정 성공으로 포장하지 않는다.
fn repeated_non_ascii(bytes: &[u8], high_bytes: &[u8]) -> bool {
    bytes
        .iter()
        .all(|byte| *byte >= 0x80 || byte.is_ascii_whitespace())
        && (1..=4).any(|width| {
            high_bytes.len() >= width * 3
                && high_bytes.len().is_multiple_of(width)
                && high_bytes.get(..width).is_some_and(|pattern| {
                    high_bytes.chunks_exact(width).all(|unit| unit == pattern)
                })
        })
}

/// ASCII UTF-8보다 먼저 처리할 ISO-2022-JP의 명시 전환 바이트.
fn has_iso2022_escape(bytes: &[u8]) -> bool {
    bytes
        .windows(3)
        .any(|unit| matches!(unit, b"\x1b$B" | b"\x1b$@" | b"\x1b(J" | b"\x1b(I"))
}

/// 대체 문자 없이 전체 입력을 디코딩한다.
fn strict_decode<'a>(
    encoding: &'static Encoding,
    bytes: &'a [u8],
) -> Result<Cow<'a, str>, &'static str> {
    encoding
        .decode_without_bom_handling_and_without_replacement(bytes)
        .ok_or("corrupt-encoding")
}

/// UTF-32의 불완전한 단위·서로게이트·범위 밖 값을 거부한다.
fn decode_utf32(bytes: &[u8], little: bool) -> Result<String, &'static str> {
    let mut text = String::new();
    let mut units = bytes.chunks_exact(4);
    for unit in &mut units {
        let octets: [u8; 4] = unit.try_into().map_err(|_| "corrupt-utf32")?;
        let value = if little {
            u32::from_le_bytes(octets)
        } else {
            u32::from_be_bytes(octets)
        };
        text.push(char::from_u32(value).ok_or("corrupt-utf32")?);
    }
    if !units.remainder().is_empty() {
        return Err("corrupt-utf32");
    }
    Ok(text)
}

/// BOM이 없으면 ASCII를 포함한 강한 제로 레인만 채택하고 나머지는 추측하지 않는다.
fn unicode_lane(bytes: &[u8]) -> Option<i8> {
    let sample = bytes.get(..DETECTION_BYTES).unwrap_or(bytes);
    if sample.len() < 4 {
        return None;
    }
    for (width, lane, code) in [(4, 0, 4), (4, 3, -4), (2, 0, 2), (2, 1, -2)] {
        let mut total = 0usize;
        let mut matches = 0usize;
        for unit in sample.chunks_exact(width) {
            total += 1;
            if unit.iter().enumerate().all(|(index, byte)| {
                if index == lane {
                    *byte != 0
                } else {
                    *byte == 0
                }
            }) {
                matches += 1;
            }
        }
        if total > 0 && matches.saturating_mul(4) >= total.saturating_mul(3) {
            return Some(code);
        }
    }
    None
}

/// NUL·문서 공백 외 제어 문자·비문자를 거부한다. 실제 저장된 U+FFFD는 손실이 아니다.
pub fn valid_text(text: &str) -> bool {
    text.chars().all(|character| {
        let code = u32::from(character);
        (!character.is_control() || matches!(character, '\t' | '\n' | '\r' | '\u{c}'))
            && !(0xfdd0..=0xfdef).contains(&code)
            && code & 0xffff < 0xfffe
    })
}

/// 컨테이너·실행 형식·이미지·미디어의 위장 확장자도 닫는다.
pub fn has_binary_magic(bytes: &[u8]) -> bool {
    const MAGIC: &[&[u8]] = &[
        b"PK\x03\x04",
        b"PK\x05\x06",
        b"PK\x07\x08",
        b"\x89PNG\r\n\x1a\n",
        b"\xff\xd8\xff",
        b"II*\0",
        b"MM\0*",
        b"\x7fELF",
        b"\0asm",
        b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1",
        b"\x1f\x8b",
        b"\xfd7zXZ\0",
        b"7z\xbc\xaf\x27\x1c",
        b"\x28\xb5\x2f\xfd",
        b"SQLite format 3\0",
        b"\x93NUMPY",
        b"\xca\xfe\xba\xbe",
    ];
    MAGIC.iter().any(|magic| bytes.starts_with(magic)) || has_structural_binary_header(bytes)
}

/// ASCII 서명만으로 문서를 버리지 않는다. 구조가 없는 입력은 엄격 코덱·제어 문자 검증으로 판정한다.
fn has_structural_binary_header(bytes: &[u8]) -> bool {
    let le32 = |offset: usize| -> Option<usize> {
        let unit: [u8; 4] = bytes.get(offset..offset + 4)?.try_into().ok()?;
        usize::try_from(u32::from_le_bytes(unit)).ok()
    };
    let be32 = |offset: usize| -> Option<usize> {
        let unit: [u8; 4] = bytes.get(offset..offset + 4)?.try_into().ok()?;
        usize::try_from(u32::from_be_bytes(unit)).ok()
    };
    let bounded = |offset: usize, length: usize| {
        offset
            .checked_add(length)
            .is_some_and(|end| end <= bytes.len())
    };
    // EOF 손상은 형식 식별을 지우지 않으며 완전성은 전용 PDF 추출기가 판정합니다.
    if bytes.starts_with(b"%PDF-")
        && matches!(
            bytes.get(5..8),
            Some(b"1.0" | b"1.1" | b"1.2" | b"1.3" | b"1.4" | b"1.5" | b"1.6" | b"1.7" | b"2.0")
        )
        && matches!(bytes.get(8), Some(b'\r' | b'\n'))
    {
        return true;
    }
    if bytes.starts_with(b"BM")
        && bytes.len() >= 26
        && le32(2) == Some(bytes.len())
        && le32(10).is_some_and(|offset| (26..=bytes.len()).contains(&offset))
        && matches!(le32(14), Some(12 | 40 | 52 | 56 | 108 | 124))
    {
        return true;
    }
    if bytes.starts_with(b"MZ")
        && bytes.len() >= 64
        && le32(60).is_some_and(|offset| {
            bounded(offset, 24) && bytes.get(offset..offset + 4) == Some(b"PE\0\0")
        })
    {
        return true;
    }
    if bytes.starts_with(b"ID3")
        && bytes.len() >= 10
        && matches!(bytes.get(3), Some(2..=4))
        && bytes.get(4).is_some_and(|revision| *revision != 0xff)
        && let Some(size_bytes) = bytes.get(6..10)
        && size_bytes.iter().all(|byte| byte & 0x80 == 0)
    {
        let size = size_bytes
            .iter()
            .fold(0usize, |size, byte| (size << 7) | usize::from(*byte));
        if bounded(10, size) {
            return true;
        }
    }
    if bytes.starts_with(b"RIFF")
        && matches!(bytes.get(8..12), Some(b"WAVE" | b"AVI " | b"WEBP"))
        && le32(4).is_some_and(|size| size >= 4 && size.checked_add(8) == Some(bytes.len()))
    {
        return true;
    }
    if bytes.starts_with(b"OTTO")
        && bytes.len() >= 12
        && let Some([high, low]) = bytes.get(4..6)
    {
        let tables = usize::from(u16::from_be_bytes([*high, *low]));
        if tables > 0
            && bounded(12, tables * 16)
            && (0..tables).all(|index| {
                let record = 12 + index * 16;
                be32(record + 8)
                    .zip(be32(record + 12))
                    .is_some_and(|(offset, length)| bounded(offset, length))
            })
        {
            return true;
        }
    }
    if bytes.starts_with(b"PAR1")
        && bytes.ends_with(b"PAR1")
        && bytes.len() >= 12
        && le32(bytes.len() - 8).is_some_and(|size| size <= bytes.len() - 12)
    {
        return true;
    }
    if bytes.starts_with(b"ARROW1")
        && bytes.ends_with(b"ARROW1")
        && bytes.len() >= 18
        && le32(bytes.len() - 10).is_some_and(|size| size <= bytes.len() - 18)
    {
        return true;
    }
    if bytes.starts_with(b"GGUF") && bytes.len() >= 24 && matches!(le32(4), Some(1..=3)) {
        return true;
    }
    // ISO BMFF 박스: 크기·종류·major brand/minor version 공간까지 있어야 한다.
    if bytes.get(4..8) == Some(b"ftyp")
        && be32(0).is_some_and(|size| size >= 16 && bounded(0, size))
    {
        return true;
    }
    has_tar_header(bytes)
}

/// tar는 이름 위치의 우연한 문자열 대신 전체 헤더 checksum까지 확인한다.
fn has_tar_header(bytes: &[u8]) -> bool {
    let Some(header) = bytes.get(..512) else {
        return false;
    };
    if header.get(257..263) != Some(b"ustar\0") {
        return false;
    }
    let checksum = header.get(148..156).and_then(|field| {
        field
            .iter()
            .filter(|byte| !matches!(byte, b' ' | 0))
            .try_fold(0usize, |sum, byte| {
                (b'0'..=b'7')
                    .contains(byte)
                    .then(|| sum * 8 + usize::from(*byte - b'0'))
            })
    });
    let actual: usize = header
        .iter()
        .enumerate()
        .map(|(index, byte)| {
            if (148..156).contains(&index) {
                32
            } else {
                usize::from(*byte)
            }
        })
        .sum();
    checksum == Some(actual)
}

#[cfg(test)]
mod tests {
    use super::decode_source_bytes_json;
    use serde_json::{Value, json};

    fn decoded(bytes: &[u8]) -> Value {
        serde_json::from_str(&decode_source_bytes_json(bytes, true, 0.0)).unwrap_or(Value::Null)
    }

    #[test]
    fn text_decode_unicode_and_empty_are_lossless() {
        for (bytes, expected) in [
            (vec![], ""),
            (b"plain text".to_vec(), "plain text"),
            (vec![0xff, 0xfe, 0x48, 0, 0x69, 0], "Hi"),
            (vec![0xfe, 0xff, 0, 0x48, 0, 0x69], "Hi"),
            (vec![0xff, 0xfe, 0x3d, 0xd8, 0, 0xde], "😀"),
            (vec![0xfe, 0xff, 0xd8, 0x3d, 0xde, 0], "😀"),
            (vec![0xff, 0xfe, 0, 0, 0, 0xf6, 1, 0], "😀"),
            (vec![0, 0, 0xfe, 0xff, 0, 1, 0xf6, 0], "😀"),
            (vec![0x48, 0, 0x69, 0, 0x21, 0, 0x20, 0], "Hi! "),
            (vec![0, 0x48, 0, 0x69, 0, 0x21, 0, 0x20], "Hi! "),
            (vec![0xff, 0xfe, 0, 0, 0x48, 0, 0, 0], "H"),
            (vec![0, 0, 0xfe, 0xff, 0, 0, 0, 0x48], "H"),
            (vec![0x48, 0, 0, 0, 0x69, 0, 0, 0], "Hi"),
            (vec![0, 0, 0, 0x48, 0, 0, 0, 0x69], "Hi"),
        ] {
            let result = decoded(&bytes);
            assert_eq!(result.get("ok"), Some(&json!(true)), "{bytes:?}: {result}");
            assert_eq!(result.get("text"), Some(&json!(expected)), "{bytes:?}");
        }
    }

    #[test]
    fn text_decode_rejects_corruption_binary_and_ambiguity() {
        for bytes in [
            b"PK\x03\x04pretend text".to_vec(),
            b"bplist00\0\0\0\0".to_vec(),
            b"\x89PNG\r\n\x1a\n".to_vec(),
            vec![0xff, 0xfe, 0x00, 0xd8],
            vec![0, 0, 0xfe, 0xff, 0, 0x11, 0, 0],
            vec![0xef, 0xbb, 0xbf, 0xc3, 0x28],
            vec![0xc3, 0x28],
            vec![0xb0, 0xa1, 0xb3, 0xaa, 0xb4, 0xd9, 0x81],
            vec![0x93, 0xfa, 0x96, 0x7b, 0x8c],
            vec![
                0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea, 0x82, 0xcc, 0x95, 0xb6, 0x8f, 0xcd, 0x82, 0xc5,
                0x82, 0xb7, 0x81,
            ],
            "valid 한국어"
                .as_bytes()
                .iter()
                .copied()
                .chain([0xff])
                .collect(),
            // 엄격 디코딩 실패와 실제 저장된 U+FFFD는 서로 다른 계약이다.
            b"truncated \xef\xbf".to_vec(),
            b"surrogate \xed\xa0\x80".to_vec(),
            b"out of range \xf4\x90\x80\x80".to_vec(),
            b"abc\0def".to_vec(),
        ] {
            assert_eq!(decoded(&bytes).get("ok"), Some(&json!(false)), "{bytes:?}");
        }
    }

    #[test]
    fn text_decode_ascii_signatures_in_documentation_are_lossless() {
        for text in [
            "BM25 검색",
            "MZ is a marker",
            "ID3 metadata notes",
            "RIFF format notes",
            "%PDF- format documentation",
            "OTTO font notes",
            "PAR1 format notes",
            "ARROW1 format notes",
            "GGUF format notes",
            "bplist00 format notes",
            "GIF89a format notes",
            "OggS format notes",
            "fLaC format notes",
            "wOFF format notes",
            "wOF2 format notes",
            "glTF format notes",
            "BZh format notes",
            "Rar! format notes",
        ] {
            let result = decoded(text.as_bytes());
            assert_eq!(result.get("ok"), Some(&json!(true)), "{text}: {result}");
            assert_eq!(result.get("text"), Some(&json!(text)));
        }
    }

    #[test]
    fn text_decode_literal_replacement_character_is_lossless() {
        let text = "replacement \u{fffd} is documented";
        let result = decoded(text.as_bytes());
        assert_eq!(result.get("ok"), Some(&json!(true)));
        assert_eq!(result.get("text"), Some(&json!(text)));
    }

    #[test]
    fn text_decode_control_and_noncharacter_policy_is_unchanged() {
        // 탭·줄바꿈·페이지 나눔만 문서 공백으로 인정하고 NUL/C0/C1·비문자는 차단한다.
        let text = "line\tcolumn\r\npage\u{c}next";
        assert_eq!(decoded(text.as_bytes()).get("text"), Some(&json!(text)));
        for character in [
            '\0',
            '\u{1b}',
            '\u{7f}',
            '\u{85}',
            '\u{fdd0}',
            '\u{fffe}',
            '\u{10ffff}',
        ] {
            assert_eq!(
                decoded(format!("text {character}").as_bytes()).get("ok"),
                Some(&json!(false))
            );
        }
    }

    #[test]
    fn text_decode_structural_binary_headers_stay_closed() {
        let mut bitmap = b"BM".to_vec();
        bitmap.extend_from_slice(&54u32.to_le_bytes());
        bitmap.extend_from_slice(&[0; 4]);
        bitmap.extend_from_slice(&54u32.to_le_bytes());
        bitmap.extend_from_slice(&40u32.to_le_bytes());
        bitmap.extend_from_slice(&[0; 36]);
        let mut executable = b"MZ".to_vec();
        executable.extend_from_slice(&[0; 58]);
        executable.extend_from_slice(&64u32.to_le_bytes());
        executable.extend_from_slice(b"PE\0\0");
        executable.extend_from_slice(&[0; 20]);
        let mut font = b"OTTO\0\x01\0\x10\0\0\0\0head".to_vec();
        font.extend_from_slice(&[0; 4]);
        font.extend_from_slice(&28u32.to_be_bytes());
        font.extend_from_slice(&4u32.to_be_bytes());
        font.extend_from_slice(&[0; 4]);
        for bytes in [
            bitmap,
            executable,
            font,
            b"ID3\x04\0\0\0\0\0\0".to_vec(),
            b"RIFF\x04\0\0\0WAVE".to_vec(),
            b"%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n".to_vec(),
            b"%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n".to_vec(),
            b"%PDF-1.7\n".to_vec(),
            b"PAR1\0\0\0\0PAR1".to_vec(),
            b"ARROW1\0\0\0\0\0\0ARROW1".to_vec(),
            b"GGUF\x03\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0".to_vec(),
        ] {
            assert!(super::has_binary_magic(&bytes), "구조 헤더: {bytes:?}");
            assert_eq!(decoded(&bytes).get("ok"), Some(&json!(false)), "{bytes:?}");
        }
        // bplist는 ASCII 서명만으로 막지 않지만 실제 이진 payload는 제어 문자 검증으로 막는다.
        assert_eq!(
            decoded(b"bplist00\0\0\0\0\0\0\0\0").get("ok"),
            Some(&json!(false))
        );
    }

    #[test]
    fn text_decode_legacy_independent_bytes() {
        for (bytes, text) in [
            (
                vec![
                    0xb0, 0xa1, 0xb3, 0xaa, 0xb4, 0xd9, 0xb6, 0xf3, 0xb8, 0xb6, 0xb9, 0xd9, 0xbb,
                    0xe7,
                ],
                "가나다라마바사",
            ),
            (
                vec![
                    0xb0, 0xa1, 0xb3, 0xaa, 0xb4, 0xd9, 0xb6, 0xf3, 0xb8, 0xb6, 0xb9, 0xd9, 0xbb,
                    0xe7, 0x81, 0x41,
                ],
                "가나다라마바사갂",
            ),
            (
                vec![
                    0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea, 0x82, 0xcc, 0x95, 0xb6, 0x8f, 0xcd, 0x82,
                    0xc5, 0x82, 0xb7, 0x81, 0x42,
                ],
                "日本語の文章です。",
            ),
            (
                vec![
                    0xd6, 0xd0, 0xce, 0xc4, 0xb2, 0xe2, 0xca, 0xd4, 0xce, 0xc4, 0xb1, 0xbe, 0x90,
                    0x30, 0x81, 0x30,
                ],
                "中文测试文本𐀀",
            ),
            (
                b"caf\xe9 d\xe9j\xe0 vu \x96 r\xe9sum\xe9".to_vec(),
                "café déjà vu – résumé",
            ),
        ] {
            let result = decoded(&bytes);
            assert_eq!(result.get("ok"), Some(&json!(true)), "{bytes:?}: {result}");
            assert_eq!(
                result.get("text"),
                Some(&json!(text)),
                "{bytes:?}: {result}"
            );
        }
    }

    #[test]
    fn text_decode_explicit_escape_and_mixed_legacy_prefix() {
        for (bytes, expected) in [
            (b"\x1b$BF|K\\8l\x1b(B".as_slice(), "日本語"),
            (
                b"\xC2\xA9 caf\xE9 d\xE9j\xE0 vu \x96 r\xE9sum\xE9".as_slice(),
                "Â© café déjà vu – résumé",
            ),
        ] {
            let result = decoded(bytes);
            assert_eq!(result.get("ok"), Some(&json!(true)), "{result}");
            assert_eq!(result.get("text"), Some(&json!(expected)), "{result}");
        }
        for bytes in [
            b"\xff\xff\xff\xff\xff\xff\n".as_slice(),
            b"\x93\xfa\x93\xfa\x93\xfa\n".as_slice(),
        ] {
            assert_eq!(
                decoded(bytes).get("reason"),
                Some(&json!("ambiguous-encoding"))
            );
        }
        assert_eq!(
            decoded(b"\x1b$BF|K\\8l\x1b(B").get("selectionReason"),
            Some(&json!("iso-2022-jp-escape"))
        );
    }

    #[test]
    fn text_decode_memory_budget_fails_before_host_io() {
        for size in [67_108_865.0, -1.0, 0.5, f64::NAN, f64::INFINITY] {
            let result: Value = serde_json::from_str(&decode_source_bytes_json(&[], false, size))
                .unwrap_or(Value::Null);
            assert_eq!(result.get("ok"), Some(&json!(false)), "{size}");
            assert_eq!(
                result.get("reason"),
                Some(&json!("memory-budget")),
                "{size}"
            );
        }
    }

    #[test]
    fn text_decode_probe_does_not_return_or_truncate_body() {
        let bytes = vec![b'x'; 600 * 1024];
        let result: Value = serde_json::from_str(&decode_source_bytes_json(&bytes, false, 0.0))
            .unwrap_or(Value::Null);
        assert_eq!(result.get("ok"), Some(&json!(true)));
        assert_eq!(result.get("text"), Some(&json!("")));
        let mut damaged = bytes;
        damaged.push(0);
        assert_eq!(decoded(&damaged).get("ok"), Some(&json!(false)));
        assert_eq!(decoded(&[]).get("text"), Some(&json!("")));
    }
}
