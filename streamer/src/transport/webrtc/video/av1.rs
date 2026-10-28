//! Specification:
//! - https://aomediacodec.github.io/av1-rtp-spec/v1.0.0.html

const OBU_FORBIDDEN_BIT: u8 = 0b1000_0000;
const OBU_HAS_EXTENSION_BIT: u8 = 0b0000_0100;
const OBU_HAS_SIZE_BIT: u8 = 0b0000_0010;
const LEB128_MAX_BYTES: usize = 8;

/// Walks a low overhead bitstream format temporal unit and checks that every OBU fits inside `data`.
///
/// `rtp`'s `parse_obus` slices with the declared OBU sizes and panics when a size runs past the buffer,
/// so frames must pass this check before they reach `Av1Payloader`.
pub fn obu_stream_is_valid(data: &[u8]) -> bool {
    if data.is_empty() {
        return false;
    }

    let mut offset = 0;
    while offset < data.len() {
        let header = data[offset];
        if header & OBU_FORBIDDEN_BIT != 0 {
            return false;
        }
        offset += 1;

        if header & OBU_HAS_EXTENSION_BIT != 0 {
            if offset >= data.len() {
                return false;
            }
            offset += 1;
        }

        if header & OBU_HAS_SIZE_BIT == 0 {
            return true;
        }

        let Some((size, leb128_len)) = read_leb128(&data[offset..]) else {
            return false;
        };
        offset += leb128_len;

        match offset.checked_add(size) {
            Some(end) if end <= data.len() => offset = end,
            _ => return false,
        }
    }

    offset == data.len()
}

fn read_leb128(data: &[u8]) -> Option<(usize, usize)> {
    let mut value: u64 = 0;
    for (i, byte) in data.iter().take(LEB128_MAX_BYTES).enumerate() {
        value |= u64::from(byte & 0b0111_1111) << (i * 7);
        if byte & 0b1000_0000 == 0 {
            let value = u32::try_from(value).ok()?;
            return Some((value as usize, i + 1));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEMPORAL_DELIMITER: u8 = (2 << 3) | OBU_HAS_SIZE_BIT;
    const FRAME: u8 = (6 << 3) | OBU_HAS_SIZE_BIT;

    #[test]
    fn accepts_sized_obus() {
        let data = [TEMPORAL_DELIMITER, 0, FRAME, 3, 1, 2, 3];
        assert!(obu_stream_is_valid(&data));
    }

    #[test]
    fn accepts_multi_byte_size() {
        let mut data = vec![FRAME, 0x80, 0x01];
        data.extend_from_slice(&[0u8; 128]);
        assert!(obu_stream_is_valid(&data));
    }

    #[test]
    fn accepts_last_obu_without_size() {
        let data = [TEMPORAL_DELIMITER, 0, 6 << 3, 1, 2, 3];
        assert!(obu_stream_is_valid(&data));
    }

    #[test]
    fn rejects_size_past_end() {
        let data = [FRAME, 10, 1, 2, 3];
        assert!(!obu_stream_is_valid(&data));
    }

    #[test]
    fn rejects_unterminated_leb128() {
        let data = [FRAME, 0x80, 0x80];
        assert!(!obu_stream_is_valid(&data));
    }

    #[test]
    fn rejects_forbidden_bit_and_empty() {
        assert!(!obu_stream_is_valid(&[]));
        assert!(!obu_stream_is_valid(&[0x80 | FRAME, 0]));
    }

    #[test]
    fn rejects_missing_extension_byte() {
        assert!(!obu_stream_is_valid(&[FRAME | OBU_HAS_EXTENSION_BIT]));
    }
}
