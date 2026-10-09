import QtQuick
import QtQuick.Layouts 1.15
import QtQuick.Controls as QQC2
import org.kde.kirigami as Kirigami

Kirigami.FormLayout {
    id: page

    // Two-way bound by the Plasma config framework via the cfg_<key> convention.
    property string cfg_panelLabelMode: "min"
    property bool cfg_keepaliveEnabled: false
    property string cfg_keepaliveCommand: ""
    property string cfg_claudeLabel: "Claude"
    property string cfg_secondClaudeCredentialsPath: ""
    property string cfg_secondClaudeLabel: "Claude 2"

    QQC2.ComboBox {
        id: modeCombo
        Kirigami.FormData.label: i18n("Panel label:")
        textRole: "text"
        valueRole: "value"
        model: [
            {value: "min", text: i18n("All (minimum)")},
            {value: "claude-accounts", text: i18n("Claude accounts")},
            {value: "claude-session", text: i18n("Claude Session")},
            {value: "claude-weekly", text: i18n("Claude Weekly")},
            {value: "codex-session", text: i18n("Codex Session")},
            {value: "codex-weekly", text: i18n("Codex Weekly")}
        ]
        onActivated: page.cfg_panelLabelMode = currentValue
        Component.onCompleted: currentIndex = indexOfValue(page.cfg_panelLabelMode)
    }

    QQC2.CheckBox {
        id: keepaliveCheck
        Kirigami.FormData.label: i18n("Session keepalive:")
        text: i18n("Keep the Claude session window open")
        onToggled: page.cfg_keepaliveEnabled = checked
        Component.onCompleted: checked = page.cfg_keepaliveEnabled
    }

    QQC2.Label {
        Layout.fillWidth: true
        wrapMode: Text.WordWrap
        font.pixelSize: 11
        opacity: 0.7
        text: i18n("When no 5-hour window is active, send a one-word message to the smallest model so the window opens now instead of at your first real message. Default off.")
    }

    QQC2.TextField {
        id: keepaliveCommandField
        Kirigami.FormData.label: i18n("Keepalive command:")
        enabled: page.cfg_keepaliveEnabled
        onTextEdited: page.cfg_keepaliveCommand = text
        Component.onCompleted: text = page.cfg_keepaliveCommand
    }

    QQC2.Label {
        Layout.fillWidth: true
        wrapMode: Text.WordWrap
        font.pixelSize: 11
        opacity: 0.7
        text: i18n("Advanced: plasmashell does not see your shell PATH, so use an absolute path if claude is installed somewhere unusual.")
    }

    QQC2.TextField {
        id: claudeLabelField
        Kirigami.FormData.label: i18n("Claude card label:")
        onTextEdited: page.cfg_claudeLabel = text
        Component.onCompleted: text = page.cfg_claudeLabel
    }

    QQC2.TextField {
        id: secondClaudeCredentialsPathField
        Kirigami.FormData.label: i18n("Second Claude credentials file:")
        placeholderText: "~/.claude-work/.credentials.json"
        onTextEdited: page.cfg_secondClaudeCredentialsPath = text
        Component.onCompleted: text = page.cfg_secondClaudeCredentialsPath
    }

    QQC2.Label {
        Layout.fillWidth: true
        wrapMode: Text.WordWrap
        font.pixelSize: 11
        opacity: 0.7
        text: i18n("Leave empty to show only one Claude card. Set it to show a second Claude account (e.g. a separate CLAUDE_CONFIG_DIR) in its own card.")
    }

    QQC2.TextField {
        id: secondClaudeLabelField
        Kirigami.FormData.label: i18n("Second Claude card label:")
        enabled: page.cfg_secondClaudeCredentialsPath.length > 0
        onTextEdited: page.cfg_secondClaudeLabel = text
        Component.onCompleted: text = page.cfg_secondClaudeLabel
    }
}
