//! Model-neutral fallback protocol for providers without native function calling.

use serde_json::{Map as JsonMap, Value as JsonValue, json};
use wasm_bindgen::prelude::wasm_bindgen;

/// Opening delimiter understood by weak-model compatibility mode.
const OPEN_TAG: &str = "<tool_call>";
/// Closing delimiter understood by weak-model compatibility mode.
const CLOSE_TAG: &str = "</tool_call>";
/// Per-response bound that prevents untrusted model text from planning unbounded work.
const MAX_TOOL_CALLS: usize = 8;

/// Extracts bounded JSON tool calls from the compatibility protocol.
///
/// Text tool-call dialects that some models emit instead of the canonical block (for
/// example the DSML-style `<｜｜DSML｜｜ invoke …>` markup) are normalized first, and a
/// canonical block truncated before its closing tag is recovered when its body is still
/// one complete, valid call.
#[must_use]
#[wasm_bindgen]
pub fn plan_compatibility_tool_calls_json(content: &str) -> String {
    let normalized = normalize_tool_markup(content);
    let mut calls = Vec::<JsonValue>::new();
    let mut remaining = normalized.as_str();
    while calls.len() < MAX_TOOL_CALLS {
        let Some(open_index) = remaining.find(OPEN_TAG) else {
            break;
        };
        let after_open = &remaining[open_index + OPEN_TAG.len()..];
        if let Some(close_index) = after_open.find(CLOSE_TAG) {
            if let Some(call) = parse_call(after_open[..close_index].trim()) {
                calls.push(call);
            }
            remaining = &after_open[close_index + CLOSE_TAG.len()..];
            continue;
        }
        let Some((call, consumed)) = parse_unterminated_call(after_open) else {
            break;
        };
        calls.push(call);
        remaining = &after_open[consumed..];
    }
    json!(calls).to_string()
}

/// Removes compatibility tool-call markup from visible answer text.
///
/// Complete `<tool_call>` blocks are always removed, an unterminated block is removed
/// only when it still parses as a valid call, and control markup of the DSML dialect is
/// removed even when it does not form an executable call.
#[must_use]
#[wasm_bindgen]
pub fn strip_compatibility_tool_calls(content: &str) -> String {
    let normalized = normalize_tool_markup(content);
    let mut visible = String::with_capacity(normalized.len());
    let mut remaining = normalized.as_str();
    loop {
        let Some(open_index) = remaining.find(OPEN_TAG) else {
            visible.push_str(remaining);
            break;
        };
        visible.push_str(&remaining[..open_index]);
        let after_open = &remaining[open_index + OPEN_TAG.len()..];
        if let Some(close_index) = after_open.find(CLOSE_TAG) {
            remaining = &after_open[close_index + CLOSE_TAG.len()..];
            continue;
        }
        if let Some((_, consumed)) = parse_unterminated_call(after_open) {
            remaining = &after_open[consumed..];
            continue;
        }
        visible.push_str(&remaining[open_index..]);
        break;
    }
    visible.trim().to_owned()
}

/// Validates one compatibility call and normalizes its arguments to JSON text.
fn parse_call(body: &str) -> Option<JsonValue> {
    let value = serde_json::from_str::<JsonValue>(body).ok()?;
    let object = value.as_object()?;
    let name = object.get("name")?.as_str()?.trim();
    if name.is_empty() {
        return None;
    }
    let arguments = match object.get("arguments")? {
        JsonValue::String(arguments) => {
            let parsed = serde_json::from_str::<JsonValue>(arguments).ok()?;
            if !parsed.is_object() {
                return None;
            }
            parsed.to_string()
        }
        arguments @ JsonValue::Object(_) => arguments.to_string(),
        _ => return None,
    };
    Some(json!({ "name": name, "arguments": arguments }))
}

/// Recovers a `<tool_call>` whose closing tag is missing when its body is one balanced
/// JSON object that still satisfies the call contract. Returns the call and the byte
/// length consumed after the opening tag.
fn parse_unterminated_call(after_open: &str) -> Option<(JsonValue, usize)> {
    let trimmed = after_open.trim_start();
    let leading = after_open.len() - trimmed.len();
    let end = balanced_json_object_end(trimmed)?;
    let call = parse_call(trimmed[..end].trim())?;
    Some((call, leading + end))
}

/// Returns the byte length of the leading balanced `{…}` object, if the text starts with one.
fn balanced_json_object_end(text: &str) -> Option<usize> {
    if !text.starts_with('{') {
        return None;
    }
    let mut depth = 0usize;
    let mut in_string = false;
    let mut escaped = false;
    for (index, character) in text.char_indices() {
        if in_string {
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == '"' {
                in_string = false;
            }
            continue;
        }
        match character {
            '"' => in_string = true,
            '{' => depth += 1,
            '}' => {
                depth = depth.checked_sub(1)?;
                if depth == 0 {
                    return Some(index + character.len_utf8());
                }
            }
            _ => {}
        }
    }
    None
}

/// One DSML control tag recognized in model text output.
struct DsmlTag<'a> {
    /// Classified meaning of the tag.
    kind: DsmlTagKind<'a>,
    /// Total byte length of the tag including its delimiters.
    total_len: usize,
}

/// Classified DSML control tags that some models emit instead of the canonical protocol.
enum DsmlTagKind<'a> {
    /// Opening `calls` wrapper of an invoke list.
    CallsOpen,
    /// Closing `calls` wrapper of an invoke list.
    CallsClose,
    /// Opening `invoke` element carrying the tool name.
    InvokeOpen {
        /// Tool name from the `name` attribute.
        name: &'a str,
    },
    /// Closing `invoke` element.
    InvokeClose,
    /// Opening `parameter` element carrying its name and declared scalar mode.
    ParameterOpen {
        /// Parameter name from the `name` attribute.
        name: &'a str,
        /// Whether the value was declared as a string instead of a scalar.
        is_string: bool,
    },
    /// Closing `parameter` element.
    ParameterClose,
}

/// Rewrites DSML tool-call blocks into the canonical protocol and drops control tags.
fn normalize_tool_markup(content: &str) -> String {
    let mut output = String::with_capacity(content.len());
    let mut index = 0usize;
    while index < content.len() {
        let Some(offset) = content[index..].find('<') else {
            output.push_str(&content[index..]);
            break;
        };
        output.push_str(&content[index..index + offset]);
        index += offset;
        let Some(tag) = parse_dsml_tag(&content[index..]) else {
            let Some(character) = content[index..].chars().next() else {
                break;
            };
            output.push(character);
            index += character.len_utf8();
            continue;
        };
        if let DsmlTagKind::InvokeOpen { name } = tag.kind {
            let after_open = index + tag.total_len;
            match convert_dsml_invoke(name, &content[after_open..]) {
                DsmlInvokeOutcome::Converted { block, consumed } => {
                    output.push_str(&block);
                    index = after_open + consumed;
                }
                DsmlInvokeOutcome::Unterminated { consumed } => {
                    index = after_open + consumed;
                }
            }
            continue;
        }
        index += tag.total_len;
    }
    output
}

/// Outcome of scanning one DSML invoke block after its open tag.
enum DsmlInvokeOutcome {
    /// Complete invoke converted into the canonical call block.
    Converted {
        /// Canonical `<tool_call>` block that replaces the invoke markup.
        block: String,
        /// Bytes consumed after the invoke open tag.
        consumed: usize,
    },
    /// Unterminated invoke whose scanned control markup is dropped without executing,
    /// so partial parameters never run and never stay visible.
    Unterminated {
        /// Bytes of control markup consumed after the invoke open tag.
        consumed: usize,
    },
}

/// Converts one DSML invoke block into a canonical call block.
fn convert_dsml_invoke(name: &str, rest: &str) -> DsmlInvokeOutcome {
    let mut arguments = JsonMap::<String, JsonValue>::new();
    let mut position = 0usize;
    loop {
        let remainder = rest.get(position..).unwrap_or_default();
        let Some(character) = remainder.chars().next() else {
            return DsmlInvokeOutcome::Unterminated { consumed: position };
        };
        if character.is_whitespace() {
            position += character.len_utf8();
            continue;
        }
        let Some(tag) = parse_dsml_tag(remainder) else {
            return DsmlInvokeOutcome::Unterminated { consumed: position };
        };
        if matches!(tag.kind, DsmlTagKind::InvokeClose) {
            let call = json!({ "name": name, "arguments": JsonValue::Object(arguments) });
            let block = format!("{OPEN_TAG}{call}{CLOSE_TAG}");
            return DsmlInvokeOutcome::Converted {
                block,
                consumed: position + tag.total_len,
            };
        }
        let DsmlTagKind::ParameterOpen {
            name: key,
            is_string,
        } = tag.kind
        else {
            return DsmlInvokeOutcome::Unterminated { consumed: position };
        };
        let value_start = position + tag.total_len;
        let Some((value_len, close_len)) = find_parameter_close(&rest[value_start..]) else {
            return DsmlInvokeOutcome::Unterminated {
                consumed: rest.len(),
            };
        };
        let raw = rest[value_start..value_start + value_len].trim();
        arguments.insert(key.to_owned(), parameter_value(raw, is_string));
        position = value_start + value_len + close_len;
    }
}

/// Finds the next parameter close tag and returns its byte offset and tag length.
fn find_parameter_close(text: &str) -> Option<(usize, usize)> {
    let mut search_start = 0usize;
    while let Some(offset) = text.get(search_start..)?.find('<') {
        let index = search_start + offset;
        if let Some(tag) = parameter_close_tag(text, index) {
            return Some((index, tag.total_len));
        }
        search_start = index + 1;
    }
    None
}

/// Parses the tag at `index` only when it is a parameter close tag.
fn parameter_close_tag(text: &str, index: usize) -> Option<DsmlTag<'_>> {
    let tag = parse_dsml_tag(text.get(index..)?)?;
    matches!(tag.kind, DsmlTagKind::ParameterClose).then_some(tag)
}

/// Parses one DSML control tag at the start of `text`.
///
/// The delimiter bars accept both the fullwidth `｜` and the ASCII `|` so that endpoints
/// that mangle the special token keep working.
fn parse_dsml_tag(text: &str) -> Option<DsmlTag<'_>> {
    if !text.starts_with('<') {
        return None;
    }
    let mut position = 1usize;
    let closing = text.get(position..)?.starts_with('/');
    if closing {
        position += 1;
    }
    position = skip_bars(text, position)?;
    if !text.get(position..)?.starts_with("DSML") {
        return None;
    }
    position += "DSML".len();
    position = skip_bars(text, position)?;
    position = skip_tag_whitespace(text, position);
    let tag_end = position + text.get(position..)?.find('>')?;
    let body = text.get(position..tag_end)?;
    let kind = parse_dsml_tag_kind(body, closing)?;
    Some(DsmlTag {
        kind,
        total_len: tag_end + 1,
    })
}

/// Classifies one DSML tag body (keyword plus attributes).
fn parse_dsml_tag_kind(body: &str, closing: bool) -> Option<DsmlTagKind<'_>> {
    let split = body.find(char::is_whitespace).unwrap_or(body.len());
    let keyword = body.get(..split)?;
    let attributes = body.get(split..)?.trim();
    match (keyword, closing) {
        ("calls", false) => Some(DsmlTagKind::CallsOpen),
        ("calls", true) => Some(DsmlTagKind::CallsClose),
        ("invoke", true) => Some(DsmlTagKind::InvokeClose),
        ("parameter", true) => Some(DsmlTagKind::ParameterClose),
        ("invoke", false) => Some(DsmlTagKind::InvokeOpen {
            name: read_attribute(attributes, "name")?,
        }),
        ("parameter", false) => Some(DsmlTagKind::ParameterOpen {
            name: read_attribute(attributes, "name")?,
            is_string: read_attribute(attributes, "string") == Some("true"),
        }),
        _ => None,
    }
}

/// Reads a quoted attribute value from a DSML tag body.
fn read_attribute<'a>(attributes: &'a str, key: &str) -> Option<&'a str> {
    let marker = format!("{key}=\"");
    let start = attributes.find(&marker)? + marker.len();
    let remainder = attributes.get(start..)?;
    let end = remainder.find('"')?;
    let value = remainder.get(..end)?;
    if value.is_empty() {
        return None;
    }
    Some(value)
}

/// Consumes one or more DSML bar characters and returns the new position.
fn skip_bars(text: &str, position: usize) -> Option<usize> {
    let mut next = position;
    while let Some(character) = text.get(next..)?.chars().next() {
        if character != '｜' && character != '|' {
            break;
        }
        next += character.len_utf8();
    }
    (next > position).then_some(next)
}

/// Consumes ASCII whitespace inside a control tag.
fn skip_tag_whitespace(text: &str, position: usize) -> usize {
    let mut next = position;
    while let Some(character) = text.get(next..).and_then(|rest| rest.chars().next()) {
        if !character.is_ascii_whitespace() {
            break;
        }
        next += character.len_utf8();
    }
    next
}

/// Converts one raw DSML parameter value into a JSON value.
fn parameter_value(raw: &str, is_string: bool) -> JsonValue {
    if is_string {
        return JsonValue::String(raw.to_owned());
    }
    if raw == "true" {
        return JsonValue::Bool(true);
    }
    if raw == "false" {
        return JsonValue::Bool(false);
    }
    if let Some(parsed) = parse_json_parameter(raw) {
        return parsed;
    }
    parse_number(raw).unwrap_or_else(|| JsonValue::String(raw.to_owned()))
}

/// Parses a JSON object or array parameter value when the raw text looks like JSON.
fn parse_json_parameter(raw: &str) -> Option<JsonValue> {
    if !raw.starts_with('{') && !raw.starts_with('[') {
        return None;
    }
    serde_json::from_str::<JsonValue>(raw).ok()
}

/// Parses an integer or finite decimal parameter value.
fn parse_number(raw: &str) -> Option<JsonValue> {
    if let Ok(integer) = raw.parse::<i64>() {
        return Some(json!(integer));
    }
    match raw.parse::<f64>() {
        Ok(number) if number.is_finite() => Some(json!(number)),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use serde_json::{Value as JsonValue, json};

    use super::{plan_compatibility_tool_calls_json, strip_compatibility_tool_calls};

    fn parsed_arguments(parsed: &JsonValue, index: usize) -> JsonValue {
        parsed
            .get(index)
            .and_then(|call| call.get("arguments"))
            .and_then(JsonValue::as_str)
            .and_then(|arguments| serde_json::from_str::<JsonValue>(arguments).ok())
            .unwrap_or(JsonValue::Null)
    }

    #[test]
    fn extracts_object_and_string_arguments() {
        let content = concat!(
            "조사하겠습니다.\n",
            "<tool_call>{\"name\":\"superpower_inside\",\"arguments\":{\"action\":\"search\",\"query\":\"alpha\"}}</tool_call>",
            "<tool_call>{\"name\":\"other\",\"arguments\":\"{\\\"path\\\":\\\"A.md\\\"}\"}</tool_call>"
        );
        let output = plan_compatibility_tool_calls_json(content);
        let parsed = serde_json::from_str::<JsonValue>(&output).unwrap_or(JsonValue::Null);

        assert_eq!(parsed.as_array().map(Vec::len), Some(2));
        assert_eq!(
            parsed.get(0).and_then(|call| call.get("name")),
            Some(&json!("superpower_inside"))
        );
        assert_eq!(
            parsed.get(1).and_then(|call| call.get("arguments")),
            Some(&json!("{\"path\":\"A.md\"}"))
        );
    }

    #[test]
    fn ignores_invalid_calls_and_strips_only_complete_blocks() {
        let content = "앞 <tool_call>{invalid}</tool_call> 뒤 <tool_call>unfinished";

        assert_eq!(plan_compatibility_tool_calls_json(content), "[]");
        assert_eq!(
            strip_compatibility_tool_calls(content),
            "앞  뒤 <tool_call>unfinished"
        );
    }

    #[test]
    fn normalizes_dsml_invoke_into_canonical_calls() {
        let content = concat!(
            "<｜｜DSML｜｜ calls>\n",
            "<｜｜DSML｜｜ invoke name=\"demo_search\">\n",
            "<｜｜DSML｜｜ parameter name=\"query\" string=\"true\">alpha beta</｜｜DSML｜｜ parameter>\n",
            "<｜｜DSML｜｜ parameter name=\"limit\" string=\"false\">3</｜｜DSML｜｜ parameter>\n",
            "</｜｜DSML｜｜ invoke>\n",
            "</｜｜DSML｜｜ calls>"
        );
        let output = plan_compatibility_tool_calls_json(content);
        let parsed = serde_json::from_str::<JsonValue>(&output).unwrap_or(JsonValue::Null);

        assert_eq!(parsed.as_array().map(Vec::len), Some(1));
        assert_eq!(
            parsed.get(0).and_then(|call| call.get("name")),
            Some(&json!("demo_search"))
        );
        let arguments = parsed_arguments(&parsed, 0);
        assert_eq!(arguments.get("query"), Some(&json!("alpha beta")));
        assert_eq!(arguments.get("limit"), Some(&json!(3)));
        assert_eq!(strip_compatibility_tool_calls(content), "");
    }

    #[test]
    fn converts_ascii_dsml_variants_and_keeps_prose() {
        let content = concat!(
            "앞 <|DSML| invoke name=\"demo_read\">",
            "<|DSML| parameter name=\"path\" string=\"true\">A.md</|DSML| parameter>",
            "<|DSML| parameter name=\"flag\" string=\"false\">true</|DSML| parameter>",
            "</|DSML| invoke>",
            "<|DSML| invoke name=\"demo_write\">",
            "<|DSML| parameter name=\"mode\" string=\"true\">10</|DSML| parameter>",
            "<|DSML| parameter name=\"options\" string=\"false\">{\"deep\":true}</|DSML| parameter>",
            "</|DSML| invoke> 뒤"
        );
        let output = plan_compatibility_tool_calls_json(content);
        let parsed = serde_json::from_str::<JsonValue>(&output).unwrap_or(JsonValue::Null);

        assert_eq!(parsed.as_array().map(Vec::len), Some(2));
        assert_eq!(
            parsed.get(0).and_then(|call| call.get("name")),
            Some(&json!("demo_read"))
        );
        let first = parsed_arguments(&parsed, 0);
        assert_eq!(first.get("path"), Some(&json!("A.md")));
        assert_eq!(first.get("flag"), Some(&json!(true)));
        let second = parsed_arguments(&parsed, 1);
        assert_eq!(second.get("mode"), Some(&json!("10")));
        assert_eq!(second.get("options"), Some(&json!({"deep": true})));
        assert_eq!(strip_compatibility_tool_calls(content), "앞  뒤");
    }

    #[test]
    fn recovers_unterminated_canonical_block_before_stray_dsml_closers() {
        let content = concat!(
            "<tool_call>{\"name\":\"demo_read\",\"arguments\":{\"path\":\"A.md\"}}",
            "</｜｜DSML｜｜ parameter></｜｜DSML｜｜ invoke></｜｜DSML｜｜ calls>"
        );
        let output = plan_compatibility_tool_calls_json(content);
        let parsed = serde_json::from_str::<JsonValue>(&output).unwrap_or(JsonValue::Null);

        assert_eq!(parsed.as_array().map(Vec::len), Some(1));
        assert_eq!(
            parsed.get(0).and_then(|call| call.get("name")),
            Some(&json!("demo_read"))
        );
        assert_eq!(strip_compatibility_tool_calls(content), "");
    }

    #[test]
    fn keeps_invalid_unterminated_blocks_visible() {
        let content = "<tool_call>{not-json";

        assert_eq!(plan_compatibility_tool_calls_json(content), "[]");
        assert_eq!(
            strip_compatibility_tool_calls(content),
            "<tool_call>{not-json"
        );
    }

    #[test]
    fn drops_stray_dsml_control_tags_from_visible_text() {
        let content = "<｜｜DSML｜｜ calls>검색 결과</｜｜DSML｜｜ calls>";

        assert_eq!(plan_compatibility_tool_calls_json(content), "[]");
        assert_eq!(strip_compatibility_tool_calls(content), "검색 결과");
    }

    #[test]
    fn drops_unterminated_dsml_invoke_without_executing_partial_parameters() {
        let content = concat!(
            "조사 중 <｜｜DSML｜｜ invoke name=\"demo_read\">",
            "<｜｜DSML｜｜ parameter name=\"path\" string=\"true\">A.md</｜｜DSML｜｜ parameter>"
        );

        assert_eq!(plan_compatibility_tool_calls_json(content), "[]");
        assert_eq!(strip_compatibility_tool_calls(content), "조사 중");
    }
}
