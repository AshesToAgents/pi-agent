# Web Tools Extension

Adds `web_search` and `web_fetch` tools to pi using Anthropic's server-side web tools. Only active when the current model is from an Anthropic provider.

## Tools

### `web_search`

Search the web and get results with titles, URLs, and snippets.

| Parameter  | Type   | Default | Description                              |
|------------|--------|---------|------------------------------------------|
| `query`    | string | —       | Search query (required)                  |
| `max_uses` | number | —       | Maximum number of searches per request   |

### `web_fetch`

Fetch a web page and return its content as clean text.

| Parameter   | Type    | Default | Description                              |
|-------------|---------|---------|------------------------------------------|
| `url`       | string  | —       | URL to fetch (required)                  |
| `max_uses`  | number  | —       | Maximum number of fetches per request    |
| `citations` | boolean | false   | Enable citations for fetched content     |

## Requirements

- An Anthropic provider must be configured with a valid API key.
- The active model must be from the `anthropic` provider; the tools are automatically hidden otherwise.
