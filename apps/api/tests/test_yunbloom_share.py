import json

from app.providers.yunbloom_share import parse_share_sse, parse_share_stream_data


def event(payload: object) -> str:
    return f"data:{json.dumps(payload, ensure_ascii=False)}\n"


def test_reassembles_streamed_text_and_usage() -> None:
    source = "".join(
        [
            event({"role": "assistant", "content": "API", "name": "data", "type": "data"}),
            event({"role": "assistant", "content": "_OK", "name": "data", "type": "data"}),
            event({"end": {"cost": 1, "completion_id": 5247}}),
        ]
    )
    result = parse_share_sse(source)
    assert result.content == "API_OK"
    assert result.cost == 1
    assert result.completion_id == 5247


def test_extracts_nested_openai_tool_calls() -> None:
    nested = {
        "choices": [
            {
                "message": {
                    "role": "assistant",
                    "content": "",
                    "tool_calls": [
                        {
                            "id": "call_123",
                            "type": "function",
                            "function": {
                                "name": "sum_numbers",
                                "arguments": '{"a":137,"b":289}',
                            },
                        }
                    ],
                },
                "finishReason": "tool_calls",
            }
        ]
    }
    source = event(
        {
            "role": "assistant",
            "content": json.dumps(nested),
            "name": "data",
            "type": "data",
        }
    )
    result = parse_share_sse(source)
    assert result.content == ""
    assert result.tool_calls[0].function.name == "sum_numbers"
    assert json.loads(result.tool_calls[0].function.arguments) == {"a": 137, "b": 289}

    stream_events = parse_share_stream_data(json.dumps(json.loads(source[5:])))
    assert stream_events[0].type == "tool-call"
    assert stream_events[0].name == "sum_numbers"


def test_parses_text_delta_for_live_rendering() -> None:
    events = parse_share_stream_data(
        json.dumps({"role": "assistant", "content": "实时", "name": "data", "type": "data"})
    )
    assert events[0].type == "text-delta"
    assert events[0].delta == "实时"
