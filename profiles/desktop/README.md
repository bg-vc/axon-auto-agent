# Desktop profile

Out-of-tree compatibility profile for the Axon Auto Agent utility process. The desktop
pins the published DeepSeek Harness `0.1.0-rc.6` release because the planned
`0.1.0-rc.5` version does not exist in npm.

The first vertical slice keeps the custom desktop renderer independent from DSH Web.
`profile.json` is packaged with the app and records the tested plugin boundary; the
runtime compatibility probe fails visibly when the installed Harness version drifts.
