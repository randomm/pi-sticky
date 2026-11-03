# Changelog

## 0.1.0 (2026-11-03)


### Features

* add AGENTS.md ([77db53d](https://github.com/randomm/pi-sticky/commit/77db53ddb134dd562d9b6176311a8a24120a6129))
* bordered pins panel in the top-right corner ([#18](https://github.com/randomm/pi-sticky/issues/18)) ([6c84def](https://github.com/randomm/pi-sticky/commit/6c84defde89e3522f3ecbe0e69dd3f0ff78977f0))
* **panel:** an auto-opened panel returns to peek ([#76](https://github.com/randomm/pi-sticky/issues/76)) ([77adf91](https://github.com/randomm/pi-sticky/commit/77adf917076863ebd2631c61c5a398e0e925d249))
* **panel:** compact pin age with a once-a-minute redraw ([#47](https://github.com/randomm/pi-sticky/issues/47)) ([6d52522](https://github.com/randomm/pi-sticky/commit/6d525223253b541f64cbb418003294640e67fb14))
* **panel:** expand a compact pin while it is selected ([#77](https://github.com/randomm/pi-sticky/issues/77)) ([770d241](https://github.com/randomm/pi-sticky/commit/770d24175fc669f8fba1cca29478ca377df44243))
* **panel:** level sections and a counts frame title ([#48](https://github.com/randomm/pi-sticky/issues/48)) ([d9a5d80](https://github.com/randomm/pi-sticky/commit/d9a5d80e54eff9ca8d4a318dc7243c9d818ad333))
* **panel:** number keys 1-4 fill the editor with an option… ([#57](https://github.com/randomm/pi-sticky/issues/57)) ([640fe8e](https://github.com/randomm/pi-sticky/commit/640fe8ef25da2ecb3f2d86dc4346296d91fbfdf8)), closes [#39](https://github.com/randomm/pi-sticky/issues/39)
* **panel:** peek resting state, PI_STICKY_PANEL, auto-show only for asks and warnings ([#49](https://github.com/randomm/pi-sticky/issues/49)) ([cf40dda](https://github.com/randomm/pi-sticky/commit/cf40ddaec3255e6ed01531a57149b1f58d86c485))
* pure modules - types, config, sanitizer, state, renderer ([#4](https://github.com/randomm/pi-sticky/issues/4)) ([5c71b91](https://github.com/randomm/pi-sticky/commit/5c71b911e71d8af816262e969d8b72e62f9bd639))
* **release:** automate releases with release-please and npm trusted publishing ([#82](https://github.com/randomm/pi-sticky/issues/82)) ([a9cb660](https://github.com/randomm/pi-sticky/commit/a9cb66078fddacb0cd61789da7d01185800cec75))
* **render:** draw group, options and compact on every surface ([#56](https://github.com/randomm/pi-sticky/issues/56)) ([6f4e94c](https://github.com/randomm/pi-sticky/commit/6f4e94c027e6421e553fd0f0036139cc51f95ff8))
* right-hand pins panel with toggle, focus and keyboard ([#10](https://github.com/randomm/pi-sticky/issues/10)) ([7a2b0ef](https://github.com/randomm/pi-sticky/commit/7a2b0ef6f562ff72e189bc02527b09ca5a8fcac0))
* **skills:** ship sticky-basics, sticky-decisions,… ([#58](https://github.com/randomm/pi-sticky/issues/58)) ([5f4fc85](https://github.com/randomm/pi-sticky/commit/5f4fc85edf05bd33a03fd21c3a59fc48262c323e)), closes [#37](https://github.com/randomm/pi-sticky/issues/37)
* **skills:** sticky-noni bridge skill and README Using with noni ([#60](https://github.com/randomm/pi-sticky/issues/60)) ([0cfb704](https://github.com/randomm/pi-sticky/commit/0cfb7047585b6dd5ab2541da4491108366990ffa))
* **tool:** optional group, options and compact pin fields ([#55](https://github.com/randomm/pi-sticky/issues/55)) ([dfe313d](https://github.com/randomm/pi-sticky/commit/dfe313d40b4ff25661bc699e1ab699842d7319de))
* wire pin_for_user tool, rail, /pins, /unpin and reminder ([#6](https://github.com/randomm/pi-sticky/issues/6)) ([808ec3e](https://github.com/randomm/pi-sticky/commit/808ec3eac8eed6e00a66fa76db5eb5c770de68ba))
* **work:** Make the panel shortcuts configurable through ([#29](https://github.com/randomm/pi-sticky/issues/29)) ([c613195](https://github.com/randomm/pi-sticky/commit/c613195ddb90e36ef6bce7dacb3ce8806bc1d3e7)), closes [#25](https://github.com/randomm/pi-sticky/issues/25)
* **work:** Reply flow: when the user submits a message… ([#12](https://github.com/randomm/pi-sticky/issues/12)) ([6a64a65](https://github.com/randomm/pi-sticky/commit/6a64a6515369571eeb4c81a1c7f7295ba6efcb20)), closes [#11](https://github.com/randomm/pi-sticky/issues/11)


### Bug Fixes

* **panel:** keep the selected pin's section heading in view, and draw headings with the row markers ([#54](https://github.com/randomm/pi-sticky/issues/54)) ([ad77dd1](https://github.com/randomm/pi-sticky/commit/ad77dd1dde33bb6c99808719e62cde8c7f03ee50))
* **panel:** rank like the rail, never cut #id, unfocused reply hint ([#46](https://github.com/randomm/pi-sticky/issues/46)) ([32b3955](https://github.com/randomm/pi-sticky/commit/32b3955941e2cc0ba16b81c852559a866713d377))
* **panel:** release the keyboard when the panel stops being visible ([#85](https://github.com/randomm/pi-sticky/issues/85)) ([eef5f09](https://github.com/randomm/pi-sticky/commit/eef5f09b6fef3946ef7f4f9b9333a810545cc1e5))
* **panel:** show the selected pin and keep theme colours ([#73](https://github.com/randomm/pi-sticky/issues/73)) ([b7e25c5](https://github.com/randomm/pi-sticky/commit/b7e25c579aac760df94faf3ab28682907a910418))
* **panel:** wrap options and keep the selected pin's heading in view ([#75](https://github.com/randomm/pi-sticky/issues/75)) ([ff58a65](https://github.com/randomm/pi-sticky/commit/ff58a65177c431ee959d19e8aa9409ea9cfe12d3))
* **panel:** wrap pin text at the width each row is drawn at ([#74](https://github.com/randomm/pi-sticky/issues/74)) ([7ef90df](https://github.com/randomm/pi-sticky/commit/7ef90df43f6e10ab9c7e5a5eeafd62c3eccd24fc))
* **release:** keep the version guard true across releases ([#88](https://github.com/randomm/pi-sticky/issues/88)) ([21d50dd](https://github.com/randomm/pi-sticky/commit/21d50dd8f992237db83fae12459a6258b5607ed5))
* **release:** start the first release at 0.1.0 ([#87](https://github.com/randomm/pi-sticky/issues/87)) ([ae5cd39](https://github.com/randomm/pi-sticky/commit/ae5cd394d9e6db0dbd6085f1a2b0885a6225585c))
* **sanitize:** keep leading and trailing 1 and 3 in pin text ([#72](https://github.com/randomm/pi-sticky/issues/72)) ([1c95713](https://github.com/randomm/pi-sticky/commit/1c95713453b8d3d566074606da7e8ed1f0bfc3a1))
* **work:** Fix skill and README spec gaps ([#79](https://github.com/randomm/pi-sticky/issues/79)) ([71f290c](https://github.com/randomm/pi-sticky/commit/71f290ccf717dbb524ceb33002739e7395d0843f))
* **work:** Pin field validation gaps ([#78](https://github.com/randomm/pi-sticky/issues/78)) ([0f954db](https://github.com/randomm/pi-sticky/commit/0f954dbedbcdc0428c92af8f51b00510b1261523)), closes [#64](https://github.com/randomm/pi-sticky/issues/64)
* **work:** Reply handler robustness ([#19](https://github.com/randomm/pi-sticky/issues/19)) ([2cadfa4](https://github.com/randomm/pi-sticky/commit/2cadfa4be5dfa7ef6376f234da5bfc64603b78cc)), closes [#17](https://github.com/randomm/pi-sticky/issues/17)
* **work:** Security hardening from the release audit ([#28](https://github.com/randomm/pi-sticky/issues/28)) ([2282cff](https://github.com/randomm/pi-sticky/commit/2282cff255cce5d88460f450200f0ac90c3d54a4)), closes [#27](https://github.com/randomm/pi-sticky/issues/27)


### Documentation

* **agents:** comment discipline and scope rules for contributors ([#50](https://github.com/randomm/pi-sticky/issues/50)) ([3a06430](https://github.com/randomm/pi-sticky/commit/3a0643075bf53e1a850bf70cc0d99efa94fb7543))
* make docs/ publishable ([#26](https://github.com/randomm/pi-sticky/issues/26)) ([8883433](https://github.com/randomm/pi-sticky/commit/888343365deda225058ed79e7d5353c2033d33f6))
* spec and implementation plan for pi-sticky ([aca6324](https://github.com/randomm/pi-sticky/commit/aca6324426de454fe1836c202abfc4276e2b0e76))
* **work:** README and AGENTS.md for pins v2 (pins v2-9) ([#59](https://github.com/randomm/pi-sticky/issues/59)) ([45796cb](https://github.com/randomm/pi-sticky/commit/45796cbec272f2d98aa2480729a3a1260ef65248)), closes [#36](https://github.com/randomm/pi-sticky/issues/36)


### Refactoring

* **panel:** carry sections and rank pins once ([#83](https://github.com/randomm/pi-sticky/issues/83)) ([9cdb116](https://github.com/randomm/pi-sticky/commit/9cdb116c39eabded7d17a81b2e395f341c786b41))
