import QtQuick 2.15
import QtQuick.Layouts 1.15
import QtQuick.Controls 2.15 as QQC2
import org.kde.kirigami 2.5 as Kirigami

Kirigami.FormLayout {
    id: page

    // Two-way bound by the Plasma config framework via the cfg_<key> convention.
    property string cfg_panelLabelMode: "min"
    property bool cfg_keepaliveEnabled: false
    property string cfg_keepaliveCommand: ""

    QQC2.ComboBox {
        id: modeCombo
        Kirigami.FormData.label: i18n("Panel label:")
        textRole: "text"
        valueRole: "value"
        model: [
            {value: "min", text: i18n("All (minimum)")},
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
}
