import type { ExtensionAPI } from "@anthropic-ai/pi-sdk";

export default function completionExtension(pi: ExtensionAPI) {
  // Check process.argv directly - runs during extension loading, before TUI
  const idx = process.argv.indexOf("--completion");
  if (idx !== -1) {
    const shell = process.argv[idx + 1];
    if (shell === "zsh") {
      console.log(generateZshCompletion());
      process.exit(0);
    } else if (shell === "bash") {
      console.log(generateBashCompletion());
      process.exit(0);
    } else {
      console.error(`Unknown shell: ${shell || "(none)"}. Supported: bash, zsh`);
      process.exit(1);
    }
  }
}

function generateZshCompletion(): string {
  return `_pi() {
  local curcontext="\$curcontext" state line
  typeset -A opt_args

  local -a subcommands=(
    'install:Install a package'
    'remove:Remove a package'
    'update:Update packages'
    'list:List installed packages'
    'config:Enable/disable package resources'
  )

  _arguments -C \\
    {-p,--print}'[Print response and exit (non-interactive)]' \\
    '--mode[Output mode]:mode:(json rpc)' \\
    '--export[Export session to HTML]:input file:_files' \\
    '--provider[Provider name]:provider:(anthropic openai google openrouter aws-bedrock gcp-vertex ollama lmstudio vllm)' \\
    '--model[Model ID or pattern]:model:' \\
    '--api-key[API key]:key:' \\
    '--thinking[Thinking level]:level:(off minimal low medium high xhigh)' \\
    '--models[Comma-separated model patterns for cycling]:patterns:' \\
    '--list-models[List available models]::search:' \\
    {-c,--continue}'[Continue most recent session]' \\
    {-r,--resume}'[Browse and select from past sessions]' \\
    '--session[Use specific session file or partial UUID]:session:' \\
    '--session-dir[Custom session storage directory]:directory:_directories' \\
    '--no-session[Ephemeral mode (do not save)]' \\
    '--tools[Comma-separated tools to enable]:tools:' \\
    '--no-tools[Disable all built-in tools]' \\
    '*'{-e,--extension}'[Load extension]:source:_files' \\
    '--no-extensions[Disable extension auto-discovery]' \\
    '*--skill[Load skill]:path:_files' \\
    '--no-skills[Disable skill auto-discovery]' \\
    '*--prompt-template[Load prompt template]:path:_files' \\
    '--no-prompt-templates[Disable prompt template discovery]' \\
    '*--theme[Load theme]:path:_files' \\
    '--no-themes[Disable theme discovery]' \\
    '--system-prompt[Replace default system prompt]:text:' \\
    '--append-system-prompt[Append to system prompt]:text:' \\
    '--verbose[Force verbose startup]' \\
    {-h,--help}'[Show help]' \\
    {-v,--version}'[Show version]' \\
    '--completion[Output shell completion script]:shell:(bash zsh)' \\
    '1:command:->cmd' \\
    '*:file:_files' \\
    && return

  case "\$state" in
    cmd)
      _describe -t subcommands 'pi command' subcommands
      _files
      ;;
  esac
}

compdef _pi pi`;
}

function generateBashCompletion(): string {
  return `# bash completion for pi

_pi() {
  local cur prev words cword
  _init_completion || return

  local subcommands="install remove update list config"
  local flags="-p --print --mode --export --provider --model --api-key --thinking --models --list-models -c --continue -r --resume --session --session-dir --no-session --tools --no-tools -e --extension --no-extensions --skill --no-skills --prompt-template --no-prompt-templates --theme --no-themes --system-prompt --append-system-prompt --verbose -h --help -v --version --completion"

  case "\$prev" in
    --mode)
      COMPREPLY=( \$(compgen -W "json rpc" -- "\$cur") )
      return
      ;;
    --thinking)
      COMPREPLY=( \$(compgen -W "off minimal low medium high xhigh" -- "\$cur") )
      return
      ;;
    --provider)
      COMPREPLY=( \$(compgen -W "anthropic openai google openrouter aws-bedrock gcp-vertex ollama lmstudio vllm" -- "\$cur") )
      return
      ;;
    --completion)
      COMPREPLY=( \$(compgen -W "bash zsh" -- "\$cur") )
      return
      ;;
    --tools)
      COMPREPLY=( \$(compgen -W "read bash edit write grep find ls" -- "\$cur") )
      return
      ;;
    --session-dir|--export|--extension|--skill|--prompt-template|--theme)
      _filedir
      return
      ;;
    install|remove)
      return
      ;;
  esac

  if [[ "\$cur" == -* ]]; then
    COMPREPLY=( \$(compgen -W "\$flags" -- "\$cur") )
    return
  fi

  if [[ \$cword -eq 1 ]]; then
    COMPREPLY=( \$(compgen -W "\$subcommands" -- "\$cur") )
    return
  fi

  _filedir
}

complete -F _pi pi`;
}
